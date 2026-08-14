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

    const prompt = `You are the arranging brain inside a serious songwriter's lead-sheet studio. Make the supplied lyrics immediately playable by a musician while preserving the user's words exactly.

HARMONIC REFERENCE IS SACRED:
If the inspiration contains a chord chart, it is the authoritative reference. Preserve the exact chord names, order, inversions/slash bass, extensions, and descending bass motion from that chart. Do not simplify. Do not replace D7/F# with D7, or D5/C with D. Do not transpose unless explicitly requested. A supplied chart is more important than your own guess about the song.

LEAD-SHEET QUALITY:
- Think like a professional guitarist/pianist preparing a Nashville-style or jazz/songbook lead sheet.
- Use root-position chords only when they are actually appropriate.
- Preserve and use maj7, m7, 7, 6, 9, add9, sus2, sus4, altered dominants, diminished/passing chords, slash chords and inversions when supported by the reference or musically justified.
- Track bass-line continuity. Descending bass sequences must remain explicit.
- Chord rhythm is NOT limited to two chords per lyric line or two chords per bar. There is NO arbitrary chord-count limit. Use as many events as the music requires, including rapid passing changes, while keeping them rhythmically plausible. A 4/4 bar may contain 1, 2, 3, 4, 5, 6, 7, 8 or more chord events if the supplied reference indicates them. Use beat values such as 1, 1.5, 2, 2.5, 3, 3.5, 4 and other sensible decimals.
- If the reference chart shows several chords over one lyric line, preserve every one.
- A line may span as many bars as necessary. Never force a lyric line into one bar.

LYRIC ALIGNMENT:
- Preserve every non-empty lyric line EXACTLY.
- Every chord event must have a zero-based wordIndex relative to the FULL lyric line and a beat within its bar.
- Count words exactly from line.text, left to right.
- Put each chord above the word/syllable where the change happens. If several chords occur on the same word, keep them as separate events with different beats; the renderer will display them side-by-side rather than on top of each other.
- If a chord happens between words, attach it to the nearest following word and use its beat to preserve timing.
- Never concatenate chord names into lyric text.

FORM:
- Build real sections and natural phrasing. Do not make every line identical in harmonic density.
- If the user provides only a verse, do not invent a full song's lyrics. Develop the supplied material into a lead sheet and use empty/new sections only when appropriate.
- Keep the user's requested BPM exactly if supplied; otherwise choose a sensible BPM.

RETURN ONLY VALID JSON matching this schema:
{"title":"string","key":"string","bpm":78,"timeSignature":"4/4","feel":"string","sections":[{"name":"Verse 1","lines":[{"text":"exact lyric line","bars":[{"chords":[{"name":"C/E","wordIndex":0,"beat":1},{"name":"Am7/G","wordIndex":3,"beat":3}],"lyricCue":"bar 1"}]}]}],"melody":{"contour":"string","range":"string","rhythm":"string"},"arrangement":"string"}

LYRICS:
${lyrics}

MUSICAL REFERENCE / INSPIRATION / USER-SUPPLIED CHORD CHART:
${inspiration || 'Intimate, organic singer-songwriter arrangement with tasteful harmonic movement and clear melodic phrasing.'}`;

    const requestBody = JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.25,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert guitarist, pianist, arranger, and lead-sheet editor. Musical accuracy, harmonic detail, and exact lyric alignment are more important than novelty. Return valid JSON only.' },
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

    // Normalize without imposing an artificial chord-count limit.
    for (const section of song.sections) for (const line of (section.lines || [])) {
      const words = String(line.text || '').trim().split(/\s+/).filter(Boolean);
      const maxWord = Math.max(0, words.length - 1);
      for (const bar of (line.bars || [])) {
        bar.chords = (bar.chords || []).map((c, i) => {
          if (typeof c === 'string') return { name: c, wordIndex: Math.min(i, maxWord), beat: i + 1 };
          const rawIndex = Number(c?.wordIndex);
          const rawBeat = Number(c?.beat);
          return {
            name: String(c?.name || ''),
            wordIndex: Number.isFinite(rawIndex) ? Math.max(0, Math.min(Math.round(rawIndex), maxWord)) : Math.min(i, maxWord),
            beat: Number.isFinite(rawBeat) ? Math.max(0.25, rawBeat) : Math.max(0.25, i + 1)
          };
        }).filter(c => c.name);
      }
    }
    return res.status(200).json(song);
  } catch (error) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'OpenAI took too long to respond. Please try again.' });
    return res.status(500).json({ error: error?.message || 'Unexpected server error.' });
  }
}
