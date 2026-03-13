'use client';
import { useState, useCallback, useRef } from 'react';

const DEBOUNCE_MS = 800;

export default function useTranslation() {
  const [isTranslating, setIsTranslating] = useState(false);
  const pendingText = useRef('');
  const debounceTimer = useRef(null);

  const translate = useCallback(async (text, sourceLang, targetLang, settings = {}) => {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        sourceLang,
        targetLang,
        apiKey: settings.apiKey || '',
        engine: settings.engine || 'openai',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.translation;
  }, []);

  const queueTranslation = useCallback((newText, sourceLang, targetLang, settings, onTranslated) => {
    pendingText.current += newText;
    clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(async () => {
      const text = pendingText.current.trim();
      if (!text) return;
      pendingText.current = '';

      setIsTranslating(true);
      try {
        const result = await translate(text, sourceLang, targetLang, settings);
        onTranslated(text, result);
      } catch (err) {
        onTranslated(text, `⚠️ Lỗi: ${err.message}`);
      } finally {
        setIsTranslating(false);
      }
    }, DEBOUNCE_MS);
  }, [translate]);

  const flush = useCallback(async (sourceLang, targetLang, settings, onTranslated) => {
    clearTimeout(debounceTimer.current);
    const text = pendingText.current.trim();
    if (!text) return;
    pendingText.current = '';

    setIsTranslating(true);
    try {
      const result = await translate(text, sourceLang, targetLang, settings);
      onTranslated(text, result);
    } catch (err) {
      onTranslated(text, `⚠️ Lỗi: ${err.message}`);
    } finally {
      setIsTranslating(false);
    }
  }, [translate]);

  return { isTranslating, queueTranslation, flush };
}
