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

    const prompt = `You are the arranging brain inside a serious songwriter's lead-sheet studio. The user supplies lyrics and may also supply a reference song, chord chart, or harmonic notes. Your job is to make the material immediately playable by a musician.

MOST IMPORTANT: THE USER MAY PROVIDE A CHORD CHART AS PART OF THE INSPIRATION. If a chord chart is supplied, treat its chord names, order, bass notes/inversions, and relative placement as the AUTHORITATIVE HARMONIC REFERENCE. Do not simplify it into generic root-position chords. Preserve slash chords such as D7/F#, D5/C, D5/B, D5/A and extensions such as maj7, m7, 6, 9, sus and altered dominants. If the supplied chart uses a descending bass line, preserve that movement explicitly. The application is intended to learn from user-supplied charts, not to invent a different progression.

IMPORTANT HARMONIC/LEAD-SHEET RULES:
1. Preserve every supplied non-empty lyric line EXACTLY. Never rewrite, add, summarize, or remove lyrics.
2. If the inspiration identifies a specific song but provides no chart, use it only as a broad musical reference. Do not claim to reproduce an official transcription. If the user supplies the actual chord chart, use that supplied material as the reference.
3. Analyze harmonic behavior: bass motion, inversions, secondary dominants, passing chords, seventh chords, extensions, suspensions, borrowed chords, cadences, turnarounds, and rhythmic chord placement.
4. NEVER flatten a distinctive progression into root-position triads. A slash chord means the bass note matters. Keep it.
5. Chords MUST be positioned over the exact lyric word where they occur. Every chord event has a zero-based wordIndex relative to the FULL lyric line and a beat within its bar. The frontend will place the chord directly above that word.
6. wordIndex must be accurate. Count words exactly from line.text, left to right. Do not use a new word count for each bar. If a chord occurs on the word “could,” its wordIndex must point to “could.”
7. Each line may span multiple bars. Use natural 4/4 phrasing unless another meter is specified. Each bar has 1-4 chord events. Use beat values 1, 2, 3, 4 or decimals such as 2.5.
8. If the supplied chart visually places a chord between words, attach it to the word it actually anticipates and use the beat to preserve timing.
9. Prefer useful chord symbols such as C/E, Am7/G, D7/F#, Gsus4, G7(b9), Cmaj7, Fmaj7, etc. Use extensions and inversions when supported by the reference or musically justified.
10. Preserve distinctive bass-line sequences. For example, if the reference contains Em, D5/C, D5/B, D5/A, output those exact slash-chord names rather than replacing them with D or Em.
11. Do not automatically change the key. If the supplied reference chart is in G, keep G unless the user explicitly asks for transposition.
12. If a BPM is specified in the inspiration, use it exactly; otherwise choose a sensible BPM.
13. Return ONLY valid JSON. No markdown and no commentary.

SCHEMA:
{"title":"string","key":"string","bpm":78,"timeSignature":"4/4","feel":"string","sections":[{"name":"Verse 1","lines":[{"text":"exact lyric line","bars":[{"chords":[{"name":"C/E","wordIndex":0,"beat":1},{"name":"Am7/G","wordIndex":3,"beat":3}],"lyricCue":"bar 1"}]}]}],"melody":{"contour":"string","range":"string","rhythm":"string"},"arrangement":"string"}

LYRICS:
${lyrics}

MUSICAL REFERENCE / INSPIRATION / USER-SUPPLIED CHORD CHART:
${inspiration || 'Intimate, organic singer-songwriter arrangement with tasteful harmonic movement and clear melodic phrasing.'}`;

    const requestBody = JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: 6500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert guitarist, pianist, arranger, and lead-sheet editor. Chord accuracy and exact lyric alignment are more important than novelty. Return valid JSON only.' },
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

    // Normalize chord events without destroying slash chords, extensions, or placement.
    for (const section of song.sections) for (const line of (section.lines || [])) {
      const words = String(line.text || '').trim().split(/\s+/).filter(Boolean);
      const maxWord = Math.max(0, words.length - 1);
      for (const bar of (line.bars || [])) {
        bar.chords = (bar.chords || []).map((c, i) => {
          if (typeof c === 'string') return { name: c, wordIndex: Math.min(i, maxWord), beat: i + 1 };
          const rawIndex = Number(c?.wordIndex);
          const rawBeat = Number(c?.beat);
          return { name: String(c?.name || ''), wordIndex: Number.isFinite(rawIndex) ? Math.max(0, Math.min(Math.round(rawIndex), maxWord)) : Math.min(i, maxWord), beat: Number.isFinite(rawBeat) ? Math.max(1, Math.min(4, rawBeat)) : i + 1 };
        }).filter(c => c.name);
      }
    }
    return res.status(200).json(song);
  } catch (error) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'OpenAI took too long to respond. Please try again.' });
    return res.status(500).json({ error: error?.message || 'Unexpected server error.' });
  }
}
