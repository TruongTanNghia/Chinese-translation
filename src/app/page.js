'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import useSpeechRecognition from '@/hooks/useSpeechRecognition';
import useTranslation from '@/hooks/useTranslation';
import useAutoConversation from '@/hooks/useAutoConversation';

const LANGUAGES = [
  { flag: '🇨🇳', name: '中文', sttCode: 'zh-CN', translateCode: 'zh', ttsCode: 'zh-CN' },
  { flag: '🇻🇳', name: 'Tiếng Việt', sttCode: 'vi-VN', translateCode: 'vi', ttsCode: 'vi-VN' },
  { flag: '🇺🇸', name: 'English', sttCode: 'en-US', translateCode: 'en', ttsCode: 'en-US' },
  { flag: '🇯🇵', name: '日本語', sttCode: 'ja-JP', translateCode: 'ja', ttsCode: 'ja-JP' },
  { flag: '🇰🇷', name: '한국어', sttCode: 'ko-KR', translateCode: 'ko', ttsCode: 'ko-KR' },
];

const TTS_LANG_MAP = {
  'zh-CN': ['zh-CN', 'zh-TW', 'zh-HK'],
  'vi-VN': ['vi-VN'],
  'en-US': ['en-US', 'en-GB'],
  'ja-JP': ['ja-JP'],
  'ko-KR': ['ko-KR'],
  zh: ['zh-CN', 'zh-TW'],
  vi: ['vi-VN'],
  en: ['en-US', 'en-GB'],
  ja: ['ja-JP'],
  ko: ['ko-KR'],
};

export default function HomePage() {
  const [viewMode, setViewMode] = useState('standard');
  const [srcIdx, setSrcIdx] = useState(0);
  const [tgtIdx, setTgtIdx] = useState(1);
  const [engine, setEngine] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [sourceBlocks, setSourceBlocks] = useState([]);
  const [targetBlocks, setTargetBlocks] = useState([]);
  const [interimText, setInterimText] = useState('');
  const [activeMic, setActiveMic] = useState(null);
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState('');
  const [convStatus, setConvStatus] = useState('idle');
  const [detectedLangLabel, setDetectedLangLabel] = useState(null);

  const [voicesReady, setVoicesReady] = useState(false);
  const voicesRef = useRef([]);
  const sourceRef = useRef(null);
  const targetRef = useRef(null);
  const autoConvRef = useRef(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Load voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) { voicesRef.current = v; setVoicesReady(true); }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const srcLang = LANGUAGES[srcIdx];
  const tgtLang = LANGUAGES[tgtIdx];

  const findSttCode = (translateCode) => {
    const lang = LANGUAGES.find(l => l.translateCode === translateCode);
    return lang ? lang.ttsCode : translateCode;
  };

  // TTS
  const findVoice = (langCode) => {
    const voices = voicesRef.current.length > 0 ? voicesRef.current : (typeof window !== 'undefined' ? window.speechSynthesis.getVoices() : []);
    if (voices.length === 0) return null;
    const candidates = TTS_LANG_MAP[langCode] || [langCode];
    for (const c of candidates) { const f = voices.find(v => v.lang.replace('_','-').toLowerCase() === c.toLowerCase() && v.name.includes('Google')); if (f) return f; }
    for (const c of candidates) { const f = voices.find(v => v.lang.replace('_','-').toLowerCase() === c.toLowerCase() && (v.name.includes('Online') || v.name.includes('Natural'))); if (f) return f; }
    for (const c of candidates) { const f = voices.find(v => v.lang.replace('_','-').toLowerCase() === c.toLowerCase()); if (f) return f; }
    const baseLang = langCode.split('-')[0].toLowerCase();
    return voices.find(v => v.lang.toLowerCase().startsWith(baseLang)) || null;
  };

  const speak = (text, langCode) => {
    return new Promise((resolve) => {
      if (!text || typeof window === 'undefined' || !window.speechSynthesis) return resolve();
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      const chunks = text.match(/[^。！？.!?\n]+[。！？.!?\n]?/g) || [text];
      const voice = findVoice(langCode);
      let i = 0;
      const next = () => {
        if (i >= chunks.length) { resolve(); return; }
        const chunk = chunks[i].trim();
        if (!chunk) { i++; next(); return; }
        const u = new SpeechSynthesisUtterance(chunk);
        u.rate = 1.0; u.lang = langCode;
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        const keepAlive = setInterval(() => { if (window.speechSynthesis.speaking) { window.speechSynthesis.pause(); window.speechSynthesis.resume(); } }, 5000);
        const timeout = setTimeout(() => { clearInterval(keepAlive); window.speechSynthesis.cancel(); resolve(); }, 30000);
        u.onend = () => { clearInterval(keepAlive); clearTimeout(timeout); i++; next(); };
        u.onerror = () => { clearInterval(keepAlive); clearTimeout(timeout); i++; next(); };
        window.speechSynthesis.speak(u);
      };
      next();
    });
  };

  // Translation hook (Standard mode)
  const { isTranslating, queueTranslation, flush } = useTranslation();

  const handleFinalResult = useCallback((text, panel) => {
    if (panel === 'source') {
      setSourceBlocks(prev => [...prev, { text, type: 'final', id: Date.now() }]);
      queueTranslation(text, LANGUAGES[srcIdx].translateCode, LANGUAGES[tgtIdx].translateCode, { apiKey, engine },
        (origText, translated) => {
          setTargetBlocks(prev => [...prev, { text: translated, type: 'final', id: Date.now() }]);
          speak(translated, LANGUAGES[tgtIdx].ttsCode);
        });
    } else {
      setTargetBlocks(prev => [...prev, { text, type: 'final', id: Date.now() }]);
      queueTranslation(text, LANGUAGES[tgtIdx].translateCode, LANGUAGES[srcIdx].translateCode, { apiKey, engine },
        (origText, translated) => {
          setSourceBlocks(prev => [...prev, { text: translated, type: 'final', id: Date.now() }]);
          speak(translated, LANGUAGES[srcIdx].ttsCode);
        });
    }
  }, [srcIdx, tgtIdx, apiKey, engine, queueTranslation]);

  const handleInterimResult = useCallback((text) => setInterimText(text), []);
  const sttSource = useSpeechRecognition({ lang: LANGUAGES[srcIdx].sttCode, onResult: (t) => handleFinalResult(t, 'source'), onInterim: handleInterimResult });

  // Auto Conversation (Giao tiếp mode)
  const handleAutoResult = useCallback(async (result) => {
    const { originalText, translatedText, detectedLang, fromLang, toLang } = result;
    setDetectedLangLabel(null);

    const srcTranslateCode = LANGUAGES[srcIdx].translateCode;
    const tgtTranslateCode = LANGUAGES[tgtIdx].translateCode;

    if (toLang === srcTranslateCode) {
      setSourceBlocks(prev => [...prev, { text: translatedText, type: 'final', id: Date.now() }]);
      setTargetBlocks(prev => [...prev, { text: originalText, type: 'final', id: Date.now() }]);
    } else if (toLang === tgtTranslateCode) {
      setTargetBlocks(prev => [...prev, { text: translatedText, type: 'final', id: Date.now() }]);
      setSourceBlocks(prev => [...prev, { text: originalText, type: 'final', id: Date.now() }]);
    } else {
      setSourceBlocks(prev => [...prev, { text: originalText, type: 'final', id: Date.now() }]);
      setTargetBlocks(prev => [...prev, { text: translatedText, type: 'final', id: Date.now() }]);
    }

    setHistory(prev => [{ source: originalText, target: translatedText, time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), id: Date.now() }, ...prev].slice(0, 100));

    const toSttCode = findSttCode(toLang);
    if (autoConvRef.current?.pause) { autoConvRef.current.pause(); setConvStatus('processing'); }
    await speak(translatedText, toSttCode);
    if (autoConvRef.current?.resume) { autoConvRef.current.resume(); setConvStatus('listening'); }

    setTimeout(() => {
      if (targetRef.current) targetRef.current.scrollTop = targetRef.current.scrollHeight;
      if (sourceRef.current) sourceRef.current.scrollTop = sourceRef.current.scrollHeight;
    }, 50);
  }, [srcIdx, tgtIdx]);

  const handleAutoTranslating = useCallback((v) => setConvStatus(v ? 'processing' : 'listening'), []);
  const handleAutoError = useCallback((msg) => showToast('❌ ' + msg), []);
  const handleLangDetected = useCallback((langCode) => {
    const lang = LANGUAGES.find(l => l.translateCode === langCode);
    setDetectedLangLabel(lang ? `${lang.flag} ${lang.name}` : langCode);
  }, []);

  const autoConv = useAutoConversation({
    apiKey, engine,
    srcLangCode: LANGUAGES[srcIdx].translateCode,
    tgtLangCode: LANGUAGES[tgtIdx].translateCode,
    onResult: handleAutoResult, onTranslating: handleAutoTranslating, onError: handleAutoError, onLangDetected: handleLangDetected,
  });

  useEffect(() => { autoConvRef.current = autoConv; }, [autoConv]);

  const formatTime = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  const toggleMic = (panel) => {
    if (viewMode === 'conversation') return;
    if (activeMic === panel) {
      sttSource.stop();
      flush(LANGUAGES[srcIdx].translateCode, LANGUAGES[tgtIdx].translateCode, { apiKey, engine },
        (o, t) => { setTargetBlocks(prev => [...prev, { text: t, type: 'final', id: Date.now() }]); speak(t, LANGUAGES[tgtIdx].ttsCode); });
      setActiveMic(null); setInterimText('');
    } else {
      if (activeMic) sttSource.stop();
      sttSource.start(); setActiveMic(panel);
    }
  };

  const toggleAutoConversation = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u);
    }
    if (autoConv.isListening) {
      autoConv.stop(); setConvStatus('idle'); setDetectedLangLabel(null);
    } else {
      setSourceBlocks([]); setTargetBlocks([]); setDetectedLangLabel(null);
      autoConv.start(); setConvStatus('listening');
    }
  };

  const swapLangs = () => { setSrcIdx(tgtIdx); setTgtIdx(srcIdx); };

  if (!mounted) return null;

  // =============== CONVERSATION MODE ===============
  const conversationView = (
    <div className="conv-auto">
      <div className="conv-auto-btn-area">
        <button className={`conv-auto-btn ${autoConv.isListening ? 'active' : ''}`} onClick={toggleAutoConversation}>
          <span className="conv-auto-btn-inner">{autoConv.isListening ? '⏹' : '🎙'}</span>
          {autoConv.isListening && <span className="pulse-ring" />}
          {autoConv.isListening && <span className="pulse-ring p2" />}
        </button>
        <div className="conv-auto-status">
          {!autoConv.isListening && '🎙️ Nhấn để bắt đầu giao tiếp'}
          {autoConv.isListening && convStatus === 'listening' && '🟢 Đang lắng nghe... Cứ nói tự nhiên!'}
          {autoConv.isListening && convStatus === 'processing' && '⏳ Đang dịch & đọc to...'}
        </div>
        {autoConv.isListening && (
          <div className="conv-auto-info">Tự phát hiện {srcLang.flag} {srcLang.name} ↔ {tgtLang.flag} {tgtLang.name}</div>
        )}
        {autoConv.isListening && (
          <div className="conv-auto-timer">{formatTime(autoConv.elapsed)}</div>
        )}
      </div>

      <div className="conv-log">
        <div className="conv-log-header">
          <span>💬 Cuộc hội thoại</span>
          <div className="panel-actions">
            <button onClick={() => { setSourceBlocks([]); setTargetBlocks([]); setHistory([]); }} title="Xóa">🗑️</button>
          </div>
        </div>
        <div className="conv-log-body" ref={targetRef}>
          {sourceBlocks.length === 0 && targetBlocks.length === 0 && (
            <div className="conv-empty">
              <div className="conv-empty-icon">💬</div>
              <div>Nhấn nút micro để bắt đầu</div>
              <div className="conv-empty-sub">Nói tiếng {srcLang.name} hoặc {tgtLang.name} — App tự nhận diện!</div>
            </div>
          )}
          {history.slice().reverse().map((h) => (
            <div key={h.id} className="conv-msg-group">
              <div className="conv-msg conv-msg-original"><span className="conv-msg-text">{h.source}</span></div>
              <div className="conv-msg conv-msg-translated"><span className="conv-msg-text">{h.target}</span></div>
            </div>
          ))}
          {autoConv.isListening && detectedLangLabel && (
            <div className="conv-msg-group conv-msg-live">
              <div className="conv-msg conv-msg-interim"><span className="conv-msg-text">🌐 Phát hiện: {detectedLangLabel}</span></div>
            </div>
          )}
          {autoConv.isListening && convStatus === 'processing' && !detectedLangLabel && (
            <div className="conv-msg-group">
              <div className="conv-msg conv-msg-interim"><span className="conv-msg-text">⏳ Đang nhận dạng...</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="app">
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />
      <div className={`container ${viewMode === 'conversation' ? 'container-conv' : ''}`}>
        <header className="header">
          <div className="logo">
            <span className="logo-icon">🎙</span>
            <h1>VoiceTranslate <sup className="badge">AI</sup></h1>
          </div>
          <div className="mode-switcher">
            <button className={viewMode === 'standard' ? 'active' : ''} onClick={() => setViewMode('standard')}>📋 Dịch thuật</button>
            <button className={viewMode === 'conversation' ? 'active' : ''} onClick={() => setViewMode('conversation')}>💬 Giao tiếp</button>
          </div>
          <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>⚙️</button>
        </header>

        {showSettings && (
          <div className="settings-panel">
            <div className="setting-row">
              <label>🔑 API Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Để trống nếu dùng env var" />
            </div>
            <div className="setting-row">
              <label>🤖 Engine</label>
              <select value={engine} onChange={(e) => setEngine(e.target.value)}>
                <option value="openai">OpenAI GPT-4o-mini</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </div>
            <div className="setting-row">
              <label>{srcLang.flag} Nguồn</label>
              <select value={srcIdx} onChange={(e) => setSrcIdx(Number(e.target.value))}>
                {LANGUAGES.map((l, i) => <option key={i} value={i}>{l.flag} {l.name}</option>)}
              </select>
            </div>
            <div className="setting-row">
              <label>{tgtLang.flag} Đích</label>
              <select value={tgtIdx} onChange={(e) => setTgtIdx(Number(e.target.value))}>
                {LANGUAGES.map((l, i) => <option key={i} value={i}>{l.flag} {l.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {viewMode === 'conversation' ? conversationView : (
          <>
            <div className="lang-bar">
              <span className="lang-chip"><span className="flag">{srcLang.flag}</span>{srcLang.name}</span>
              <button className="swap-btn" onClick={swapLangs}>⇄</button>
              <span className="lang-chip"><span className="flag">{tgtLang.flag}</span>{tgtLang.name}</span>
            </div>

            <div className="panels">
              <div className="panel panel-source">
                <div className="panel-header">
                  <span>{srcLang.flag} {srcLang.name}</span>
                  <div className="panel-actions">
                    <button onClick={() => setSourceBlocks([])} title="Xóa">🗑️</button>
                  </div>
                </div>
                <div className="panel-body" ref={sourceRef}>
                  {sourceBlocks.length === 0 && !interimText && <div className="placeholder">Nhấn micro và nói...</div>}
                  {sourceBlocks.map((b) => <div key={b.id} className="sentence">{b.text}</div>)}
                  {interimText && activeMic === 'source' && <div className="sentence interim">{interimText}</div>}
                </div>
                <div className="panel-footer">
                  <button className={`mic-btn ${activeMic === 'source' ? 'recording' : ''}`} onClick={() => toggleMic('source')}>
                    <span className="mic-icon">{activeMic === 'source' ? '⏹' : '🎤'}</span>
                    {activeMic === 'source' ? 'Dừng' : 'Nói'}
                  </button>
                  {activeMic === 'source' && <span className="timer">{formatTime(sttSource.elapsed)}</span>}
                  {isTranslating && <span className="translating-badge">⏳ Đang dịch...</span>}
                </div>
              </div>

              <div className="arrow-divider">→</div>

              <div className="panel panel-target">
                <div className="panel-header">
                  <span>{tgtLang.flag} {tgtLang.name}</span>
                  <div className="panel-actions">
                    <button onClick={() => setTargetBlocks([])} title="Xóa">🗑️</button>
                  </div>
                </div>
                <div className="panel-body" ref={targetRef}>
                  {targetBlocks.length === 0 && <div className="placeholder">Bản dịch sẽ hiện tại đây...</div>}
                  {targetBlocks.map((b) => <div key={b.id} className="sentence">{b.text}</div>)}
                </div>
              </div>
            </div>

            {history.length > 0 && (
              <div className="history">
                <div className="history-header">
                  <h2>📜 Lịch sử</h2>
                  <button onClick={() => setHistory([])}>Xóa</button>
                </div>
                <div className="history-list">
                  {history.slice(0, 10).map((h) => (
                    <div key={h.id} className="history-item">
                      <span className="hi-source">{h.source}</span>
                      <span className="hi-arrow">→</span>
                      <span className="hi-target">{h.target}</span>
                      <span className="hi-time">{h.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <footer className="footer">⚡ Powered by OpenAI Whisper + GPT</footer>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
