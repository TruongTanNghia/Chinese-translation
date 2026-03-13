export async function POST(request) {
  try {
    const { text, sourceLang, targetLang, apiKey, engine } = await request.json();

    if (!text || !sourceLang || !targetLang) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const langNames = {
      vi: 'Vietnamese', en: 'English', zh: 'Chinese',
      ja: 'Japanese', ko: 'Korean',
    };

    const sourceName = langNames[sourceLang] || sourceLang;
    const targetName = langNames[targetLang] || targetLang;

    // Try LLM first (OpenAI or DeepSeek)
    if (apiKey) {
      const configs = {
        openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
        deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
      };
      const cfg = configs[engine] || configs.openai;

      try {
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              {
                role: 'system',
                content: `Translate ${sourceName} to ${targetName}. Output ONLY the translation. Be accurate and natural.`,
              },
              { role: 'user', content: text },
            ],
            max_tokens: 4000,
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(25000),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `API error ${res.status}`);
        }

        const data = await res.json();
        return Response.json({
          translation: data.choices[0].message.content.trim(),
          engine: engine || 'openai',
        });
      } catch (llmErr) {
        console.warn('LLM failed, falling back to MyMemory:', llmErr.message);
        // Fall through to MyMemory
      }
    }

    // Fallback: MyMemory (free)
    const translation = await translateWithMyMemory(text, sourceLang, targetLang);
    return Response.json({ translation, engine: 'mymemory' });

  } catch (err) {
    console.error('Translation error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

async function translateWithMyMemory(text, source, target) {
  const MAX = 490;
  if (text.length <= MAX) {
    return myMemoryRequest(text, source, target);
  }
  // Split long text
  const sentences = text.match(/[^。！？.!?\n]+[。！？.!?\n]?/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > MAX && current) { chunks.push(current.trim()); current = s; }
    else current += s;
  }
  if (current.trim()) chunks.push(current.trim());

  const results = [];
  for (const chunk of chunks) {
    results.push(await myMemoryRequest(chunk, source, target));
  }
  return results.join(' ');
}

async function myMemoryRequest(text, source, target) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  if (data.responseStatus === 200) return data.responseData.translatedText;
  throw new Error(data.responseDetails || 'MyMemory failed');
}
