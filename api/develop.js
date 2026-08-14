export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawKey = process.env.OPENAI_API_KEY;
  if (!rawKey || typeof rawKey !== 'string') return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in Vercel.' });
  const key = rawKey.trim().replace(/^['\"]|['\"]$/g, '');
  if (!key || /[^\x20-\x7E]/.test(key)) return res.status(500).json({ error: 'OPENAI_API_KEY contains a non-ASCII character. Re-enter the API key in Vercel Environment Variables.' });

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const lyrics = String(body.lyrics ?? '');
    const inspiration = String(body.inspiration ?? '');
    if (!lyrics.trim()) return res.status(400).json({ error: 'Lyrics are required.' });

    const prompt = `You are the arranging brain inside a serious songwriter's lead-sheet studio. The user supplies lyrics and a musical reference/inspiration. Your job is to make the material immediately playable by a musician.

IMPORTANT HARMONIC/LEAD-SHEET RULES:
1. Preserve every supplied non-empty lyric line EXACTLY. Never rewrite or add lyrics.
2. If the inspiration names a specific song, you may use that song as a harmonic/arrangement reference when appropriate. The goal is musical accuracy, not generic four-chord songwriting.
3. Analyze the reference's harmonic behavior: bass motion, descending/ascending patterns, inversions, secondary dominants, passing chords, seventh chords, extensions, suspensions, borrowed chords, cadences, turnarounds, and rhythmic chord placement. Do not flatten a distinctive progression into root-position triads.
4. Prefer useful chord symbols such as C/E, Am7/G, D7/F#, Gsus4, G7(b9), Cmaj7, Fmaj7, etc. Use slash chords whenever the bass note is important. Use 6ths, 7ths, 9ths, sus chords, altered dominants, and other extensions only when musically justified.
5. Chords MUST be placed against exact lyric words. For every chord event, provide wordIndex: the zero-based index of the lyric word on which the chord is played. If a chord falls between words, attach it to the next word and use beat to indicate timing.
6. Each line is divided into bars. Every bar has 1-4 chord events. Each event has a beat from 1 to 4 (or a decimal such as 2.5) and a wordIndex relative to the FULL lyric line. Do not use a separate abstract chord list with no lyric position.
7. Chord changes should visually form a real lead sheet: chord names directly ABOVE the lyric word they accompany. Multiple chords may occur over one word only when musically necessary.
8. Infer bars from natural phrasing and meter. Do not force every lyric line into one bar. Use 2, 4, 6, 8 etc. bars as needed.
9. Preserve intentional repetition, but create real sectional contrast when the material supports it.
10. If a BPM is specified in the inspiration, use it exactly; otherwise choose a sensible BPM.
11. If an artist is named, musical characteristics can be used as reference. Do not claim the output is an official transcription or copy of a recording.
12. Return ONLY valid JSON. No markdown.

SCHEMA:
{"title":"string","key":"string","bpm":78,"timeSignature":"4/4","feel":"string","sections":[{"name":"Verse 1","lines":[{"text":"exact lyric line","bars":[{"chords":[{"name":"Cmaj7","wordIndex":0,"beat":1},{"name":"Am7/G","wordIndex":3,"beat":3}],"lyricCue":"bar 1"}]}]}],"melody":{"contour":"string","range":"string","rhythm":"string"},"arrangement":"string"}

LYRICS:
${lyrics}

MUSICAL REFERENCE / INSPIRATION:
${inspiration || 'Intimate, organic singer-songwriter arrangement with tasteful harmonic movement and clear melodic phrasing.'}`;

    const requestBody = JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 6500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert guitarist, pianist, arranger, and lead-sheet editor. Your chord placement must be precise enough for a musician to perform the song. Return valid JSON only.' },
        { role: 'user', content: prompt }
      ]
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' },
        body: requestBody,
        signal: controller.signal
      });
    } finally { clearTimeout(timeout); }

    const raw = await response.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}.`;
      if (response.status === 429) return res.status(429).json({ error: 'OpenAI rejected the request because of quota or rate limits. Check API billing/usage and try again.' });
      return res.status(502).json({ error: message });
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'OpenAI returned an empty response.' });
    let song;
    try { song = JSON.parse(content); } catch { return res.status(502).json({ error: 'OpenAI returned invalid song JSON. Try again.' }); }
    if (!song.title || !song.key || !Array.isArray(song.sections) || !song.sections.length) return res.status(502).json({ error: 'AI returned an incomplete song. Try again.' });

    // Normalize chord events so older/odd model output cannot break the lead sheet.
    for (const section of song.sections) for (const line of (section.lines || [])) {
      const words = String(line.text || '').trim().split(/\s+/).filter(Boolean);
      for (const bar of (line.bars || [])) {
        bar.chords = (bar.chords || []).map((c, i) => {
          if (typeof c === 'string') return { name: c, wordIndex: Math.min(i, Math.max(0, words.length - 1)), beat: i + 1 };
          return { name: String(c?.name || ''), wordIndex: Math.max(0, Math.min(Number(c?.wordIndex) || 0, Math.max(0, words.length - 1))), beat: Number(c?.beat) || 1 };
        }).filter(c => c.name);
      }
    }
    return res.status(200).json(song);
  } catch (error) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'OpenAI took too long to respond. Please try again.' });
    return res.status(500).json({ error: error?.message || 'Unexpected server error.' });
  }
}
