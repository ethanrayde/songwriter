export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawKey = process.env.OPENAI_API_KEY;
  if (!rawKey || typeof rawKey !== 'string') {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in Vercel.' });
  }

  const key = rawKey.trim().replace(/^['\"]|['\"]$/g, '');
  if (!key || /[^\x20-\x7E]/.test(key)) {
    return res.status(500).json({ error: 'OPENAI_API_KEY contains a non-ASCII character. Re-enter the API key in Vercel Environment Variables.' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const lyrics = String(body.lyrics ?? '');
    const inspiration = String(body.inspiration ?? '');

    if (!lyrics.trim()) return res.status(400).json({ error: 'Lyrics are required.' });

    const prompt = `You are the songwriting partner inside a serious professional songwriting studio. The user is NOT asking for generic AI lyrics. They already supplied the words. Your job is to turn those words into a musically convincing, playable song and lead sheet.

CRITICAL RULES:
1. Preserve every supplied non-empty lyric line EXACTLY. Never rewrite, summarize, add, or remove lyrics.
2. Build a complete song, not a four-chord loop. Use a believable structure such as Verse 1, Chorus, Verse 2, Chorus, Bridge, final Chorus when the material supports it. Do not force sections that make no musical sense.
3. Create harmonic contrast between sections. Repetition is useful, but use purposeful variation: inversions, secondary dominants, ii-V movement, borrowed chords, passing chords, pedal tones, altered dominants, relative major/minor shifts, or a changed cadence when stylistically appropriate.
4. Think like an arranger: chords should support the emotional meaning of the lyrics and leave room for a melody.
5. Use 1-4 chord changes per bar. Do not cram chords into every bar just to appear sophisticated.
6. Infer phrase lengths and bar groupings from the lyric phrasing. Each lyric line may span multiple bars.
7. If the inspiration specifies a BPM, use that BPM exactly. Otherwise choose a useful tempo.
8. If the inspiration names artists, use only broad musical characteristics (era, instrumentation, harmony, mood, structure). Do not imitate a living artist's exact style.
9. Give the song a coherent key, time signature, tempo, feel, melody direction, and arrangement.
10. Return ONLY valid JSON matching the schema below. No markdown and no commentary.

JSON SCHEMA:
{"title":"string","key":"string","bpm":78,"timeSignature":"4/4","feel":"string","sections":[{"name":"Verse 1","lines":[{"text":"exact lyric line","bars":[{"chords":["Cmaj7","","Dm7","G7"],"lyricCue":"bar 1"}]}]}],"melody":{"contour":"string","range":"string","rhythm":"string"},"arrangement":"string"}

LYRICS:
${lyrics}

INSPIRATION:
${inspiration || 'Choose an organic, emotionally interesting singer-songwriter direction with tasteful harmonic movement.'}`;

    const requestBody = JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.85,
      max_tokens: 5000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert songwriter, arranger, and lead-sheet editor. Return valid JSON only.' },
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
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': 'Bearer ' + key,
          'Accept': 'application/json'
        },
        body: requestBody,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}

    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}.`;
      if (response.status === 429) {
        return res.status(429).json({ error: 'OpenAI rejected the request because of quota or rate limits. Check your API billing/usage, then try again.' });
      }
      return res.status(502).json({ error: message });
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'OpenAI returned an empty response.' });

    let song;
    try { song = JSON.parse(content); }
    catch { return res.status(502).json({ error: 'OpenAI returned invalid song JSON. Try developing the song again.' }); }

    if (!song.title || !song.key || !Array.isArray(song.sections) || !song.sections.length) {
      return res.status(502).json({ error: 'AI returned an incomplete song. Try developing it again.' });
    }

    return res.status(200).json(song);
  } catch (error) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'OpenAI took too long to respond. Please try again.' });
    return res.status(500).json({ error: error?.message || 'Unexpected server error.' });
  }
}
