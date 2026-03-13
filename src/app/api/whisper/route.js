import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const apiKey = formData.get('apiKey') || process.env.OPENAI_API_KEY || '';

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file' }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: 'No API key. Set OPENAI_API_KEY env var or enter in Settings.' }, { status: 400 });
    }

    // Send to OpenAI Whisper with verbose_json to get language detection
    const whisperForm = new FormData();
    whisperForm.append('file', audioFile, 'audio.webm');
    whisperForm.append('model', 'whisper-1');
    whisperForm.append('response_format', 'verbose_json');
    
    // Provide a prompt to strongly bias Whisper towards Vietnamese or Chinese
    whisperForm.append('prompt', 'Đây là tiếng Việt. 这是中文。Xin chào, bạn khỏe không? 你好，你好吗？');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: whisperForm,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Whisper error:', err);
      return NextResponse.json({ error: 'Whisper API failed', detail: err }, { status: res.status });
    }

    const data = await res.json();
    // data.text = transcription text
    // data.language = detected language (e.g. "chinese", "vietnamese", "english")

    return NextResponse.json({
      text: data.text || '',
      language: data.language || null,
    });

  } catch (err) {
    console.error('Whisper route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
