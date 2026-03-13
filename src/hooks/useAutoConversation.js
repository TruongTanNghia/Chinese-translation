'use client';
import { useState, useRef, useCallback, useEffect } from 'react';

const SILENCE_THRESHOLD = 0.012;
const SILENCE_DURATION = 2000;
const MIN_RECORD_DURATION = 600;

const WHISPER_LANG_MAP = {
  chinese: 'zh', mandarin: 'zh',
  vietnamese: 'vi',
  english: 'en',
  japanese: 'ja',
  korean: 'ko',
};

export default function useAutoConversation({ apiKey, engine, srcLangCode, tgtLangCode, onResult, onTranslating, onError, onLangDetected }) {
  const [isListening, setIsListening] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const isRecordingChunkRef = useRef(false);
  const recordStartTimeRef = useRef(0);
  const chunksRef = useRef([]);
  const wantListeningRef = useRef(false);
  const isPausedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const rafRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const startTimeRef = useRef(0);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      wantListeningRef.current = true;
      isPausedRef.current = false;
      setIsListening(true);
      setElapsed(0);
      startTimeRef.current = Date.now();

      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      monitorAudio();
    } catch (err) {
      console.error('Mic access error:', err);
      if (onError) onError('Không thể truy cập microphone');
    }
  }, [onError]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    setIsListening(false);
    clearInterval(elapsedTimerRef.current);
    clearTimeout(silenceTimerRef.current);
    cancelAnimationFrame(rafRef.current);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  // Pause listening (during TTS playback) — physically mute mic
  const pause = useCallback(() => {
    isPausedRef.current = true;
    isSpeakingRef.current = true;
    clearTimeout(silenceTimerRef.current);
    cancelAnimationFrame(rafRef.current);
    // Stop any active recording
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    // Physically mute mic so no audio is captured at all
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
    }
  }, []);

  // Resume listening after TTS finished — unmute mic
  const resume = useCallback(() => {
    // Unmute mic
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });
    }
    isPausedRef.current = false;
    isSpeakingRef.current = false;
    isRecordingChunkRef.current = false;
    chunksRef.current = [];
    if (wantListeningRef.current) {
      monitorAudio();
    }
  }, []);

  // Monitor audio for VAD
  const monitorAudio = useCallback(() => {
    if (!analyserRef.current || !wantListeningRef.current) return;
    const analyser = analyserRef.current;
    const dataArray = new Float32Array(analyser.fftSize);

    const check = () => {
      if (!wantListeningRef.current || isPausedRef.current) return;
      analyser.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms > SILENCE_THRESHOLD) {
        clearTimeout(silenceTimerRef.current);
        if (!isRecordingChunkRef.current) startRecordingChunk();

        silenceTimerRef.current = setTimeout(() => {
          if (isRecordingChunkRef.current) stopRecordingChunk();
        }, SILENCE_DURATION);
      }

      rafRef.current = requestAnimationFrame(check);
    };
    check();
  }, []);

  const startRecordingChunk = useCallback(() => {
    if (!streamRef.current || isRecordingChunkRef.current) return;
    chunksRef.current = [];
    isRecordingChunkRef.current = true;
    recordStartTimeRef.current = Date.now();

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      isRecordingChunkRef.current = false;
      // If TTS is speaking, discard ALL recorded audio (it's feedback)
      if (isSpeakingRef.current || isPausedRef.current) {
        chunksRef.current = [];
        return;
      }
      const duration = Date.now() - recordStartTimeRef.current;
      if (duration < MIN_RECORD_DURATION || chunksRef.current.length === 0) return;
      const blob = new Blob(chunksRef.current, { type: mimeType });
      processAudioChunk(blob);
    };
    recorder.start(100);
  }, []);

  const stopRecordingChunk = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Send to Whisper → detect language → translate → callback
  const processAudioChunk = useCallback(async (audioBlob) => {
    // Block processing if TTS is playing (anti-feedback)
    if (isSpeakingRef.current || isPausedRef.current) return;
    if (onTranslating) onTranslating(true);

    try {
      // 1. Whisper
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('apiKey', apiKey);

      const whisperRes = await fetch('/api/whisper', { method: 'POST', body: formData });
      const whisperData = await whisperRes.json();

      if (!whisperRes.ok || !whisperData.text || whisperData.text.trim().length === 0) {
        if (onTranslating) onTranslating(false);
        return;
      }

      const text = whisperData.text.trim();
      const detectedLang = whisperData.language ? whisperData.language.toLowerCase() : null;
      const langCode = detectedLang ? (WHISPER_LANG_MAP[detectedLang] || detectedLang) : null;

      // Notify which language was detected
      if (onLangDetected) onLangDetected(langCode);

      // 2. Direction
      let fromLang, toLang;
      if (langCode === 'vi') {
        fromLang = 'vi';
        toLang = (srcLangCode === 'vi') ? tgtLangCode : srcLangCode;
      } else {
        fromLang = langCode || (srcLangCode !== 'vi' ? srcLangCode : tgtLangCode);
        toLang = 'vi';
      }

      // 3. Translate
      const translateRes = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sourceLang: fromLang, targetLang: toLang, apiKey, engine: engine || 'openai' }),
      });
      const translateData = await translateRes.json();
      const translated = translateData.translation || text;

      // 4. Send result — AWAIT so TTS finishes before we resume mic
      if (onResult) {
        await onResult({ originalText: text, translatedText: translated, detectedLang: langCode, fromLang, toLang });
      }

      // Buffer delay: let TTS fully stop before mic resumes
      await new Promise(r => setTimeout(r, 800));

    } catch (err) {
      console.error('Auto conversation error:', err);
      if (onError) onError('Lỗi: ' + err.message);
    } finally {
      if (onTranslating) onTranslating(false);
    }
  }, [apiKey, engine, srcLangCode, tgtLangCode, onResult, onTranslating, onError, onLangDetected]);

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      clearInterval(elapsedTimerRef.current);
      clearTimeout(silenceTimerRef.current);
      cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  return { isListening, elapsed, start, stop, pause, resume };
}
