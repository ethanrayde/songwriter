export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.OPENAI_API_KEY;
  if (!key || typeof key !== 'string') {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in Vercel.' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const lyrics = String(body.lyrics ?? '');
    const inspiration = String(body.inspiration ?? '');
    if (!lyrics.trim()) return res.status(400).json({ error: 'Lyrics are required.' });

    const prompt = `You are a sophisticated songwriting collaborator and arranger. Develop the songwriter's material into a complete, usable lead sheet. Preserve the supplied lyrics exactly; do not rewrite them. Create a real song form with harmonic movement and contrast rather than a repetitive four-chord loop. Use 2-4 chords per bar when appropriate. Different sections should have distinct harmonic roles. Choose key and tempo, but if the inspiration contains a specific BPM, use it exactly. Return ONLY valid JSON matching this shape: {"title":"string","key":"string","bpm":78,"timeSignature":"4/4","feel":"string","sections":[{"name":"Verse 1","lines":[{"text":"exact lyric line","bars":[{"chords":["Cmaj7","","Dm7","G7"],"lyricCue":"bar 1"}]}]}],"melody":{"contour":"string","range":"string","rhythm":"string"},"arrangement":"string"}. Every supplied non-empty lyric line must appear exactly once in sections[].lines[].text. Do not invent lyric text. Use blank chord strings when silence or no change is appropriate. Make the progression musically coherent and song-like, using secondary dominants, ii-V motion, borrowed chords, passing chords, pedal tones, or turnarounds only when they suit the requested style.

LYRICS:\n${lyrics}\n\nINSPIRATION:\n${inspiration}`;

    const requestBody = JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert songwriter, jazz-informed harmonic arranger, and lead-sheet editor. Output valid JSON only.' },
        { role: 'user', content: prompt }
      ]
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${key.trim()}`
        },
        body: new TextEncoder().encode(requestBody),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}

    if (!response.ok) {
      return res.status(502).json({ error: payload?.error?.message || `OpenAI returned HTTP ${response.status}.` });
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'OpenAI returned an empty response.' });

    let song;
    try { song = JSON.parse(content); }
    catch { return res.status(502).json({ error: 'OpenAI returned invalid song JSON.' }); }

    if (!song.title || !song.key || !Array.isArray(song.sections) || !song.sections.length) {
      return res.status(502).json({ error: 'AI returned an incomplete song.' });
    }

    return res.status(200).json(song);
  } catch (error) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'OpenAI took too long to respond. Please try again.' });
    return res.status(500).json({ error: error?.message || 'Unexpected server error.' });
  }
}
