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

    const prompt = `You are the harmonic arranging brain inside a serious songwriter's lead-sheet studio. Your job is NOT to invent a generic four-chord accompaniment. Your job is to create a musically playable, harmonically detailed lead sheet while preserving the user's words exactly.

CORE MUSICAL PRINCIPLE:
Follow the music, not an arbitrary data limit. There is NO maximum number of chord events per bar, NO minimum, and NO requirement that every bar have the same density. A bar may contain 1 chord or many chord changes. Use the exact harmonic rhythm that the supplied reference suggests. If a real reference has a walking bass line with several inversions, every step matters.

REFERENCE-FIRST MODE:
If the inspiration contains a chord chart, tab, lead-sheet excerpt, Roman numerals, slash chords, or explicit harmonic sequence, treat it as AUTHORITATIVE SOURCE MATERIAL. Preserve every supplied harmonic event in order. Do not summarize it. Do not reduce it to two chords. Do not convert slash chords to root position. Do not replace extensions with triads. Do not transpose unless explicitly requested.

For example, if the reference says:
G Bm C Bm Am G C G
Am D7/F# Em D5/C D5/B D5/A
then the output must be capable of representing ALL of those events, including D7/F#, D5/C, D5/B and D5/A, with sensible beat positions and lyric word anchors. The renderer must receive the full walkdown, not a simplified approximation.

HARMONIC LANGUAGE:
- Think like an expert guitarist, pianist, arranger and jazz/songbook editor.
- Use root-position chords only when they produce the desired voice-leading.
- Preserve or intelligently use maj7, m7, 7, 6, 9, add9, sus2, sus4, 11, 13, altered dominants, diminished passing chords, augmented colors, borrowed chords, secondary dominants, pedal tones, chromatic approach chords and slash-chord inversions when musically justified.
- Prioritize smooth voice-leading and bass-line continuity.
- Full ascending or descending bass walks are desirable when they fit the reference or musical intention.
- Harmonic sophistication does NOT mean random complexity. Every extra chord must have a musical reason: voice-leading, bass motion, tension/release, cadence, color, or phrasing.
- Do not make every line equally dense. Real songs breathe. Let harmony become denser where the lyric, melody, cadence, or reference calls for it.
- If the user asks for rich/complex/Beach Boys/jazz-standard-level harmony, use substantially more inversions, extensions, passing harmony and vocal-style inner movement while keeping chord symbols readable.

TIMING AND BARS:
- There is absolutely NO two-chord-per-bar rule.
- There is absolutely NO four-chord-per-bar ceiling.
- A 4/4 bar may contain 1, 2, 3, 4, 5, 6, 7, 8 or more events when musically appropriate.
- Use beats as real positions within the bar: 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, etc. If a change happens on an eighth-note or sixteenth-note subdivision, represent that timing numerically.
- Bars must be allowed to contain the complete reference progression. Never discard later chords merely to keep output visually simple.
- A lyric line may span any number of bars. Never force an entire lyric line into one bar.

LYRIC ALIGNMENT:
- Preserve every non-empty lyric line EXACTLY.
- Every chord event has a zero-based wordIndex relative to the FULL lyric line and a beat within its bar.
- Count words exactly from line.text, left to right.
- Put each chord above the word/syllable where the harmonic event occurs. If several chords happen over one word, keep them as separate events with distinct beat values; the renderer will place them side-by-side.
- If a change occurs between words, attach it to the nearest following word and preserve the beat.
- NEVER concatenate chord names into lyric text.

FORM AND MELODY:
- Build real sections and natural phrasing.
- Do not invent lyrics that the user did not provide.
- If only a verse is supplied, develop that material rather than fabricating a complete song.
- Respect an explicitly supplied BPM. Otherwise choose a sensible BPM.

RETURN ONLY VALID JSON matching this schema:
{"title":"string","key":"string","bpm":78,"timeSignature":"4/4","feel":"string","sections":[{"name":"Verse 1","lines":[{"text":"exact lyric line","bars":[{"chords":[{"name":"C/E","wordIndex":0,"beat":1},{"name":"Am7/G","wordIndex":3,"beat":2.5},{"name":"Fmaj7","wordIndex":5,"beat":3.5}],"lyricCue":"bar 1"}]}]}],"melody":{"contour":"string","range":"string","rhythm":"string"},"arrangement":"string"}

IMPORTANT OUTPUT CHECK BEFORE RETURNING:
1. Preserve every supplied chord from a reference chart.
2. Check slash chords and extensions character-for-character.
3. Check that no bar has been truncated because it contains many chord events.
4. Check that wordIndex values point into the actual lyric line.
5. Check that beat values preserve the harmonic rhythm.
6. Check that lyrics contain NO chord symbols.

LYRICS:
${lyrics}

MUSICAL REFERENCE / INSPIRATION / USER-SUPPLIED CHORD CHART:
${inspiration || 'Intimate, organic singer-songwriter arrangement with tasteful harmonic movement and clear melodic phrasing.'}`;

    const requestBody = JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.15,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert guitarist, pianist, arranger, and lead-sheet editor. Musical accuracy, complete harmonic reference preservation, voice-leading, and exact lyric alignment are more important than novelty or brevity. Return valid JSON only.' },
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

    // Normalize events without imposing ANY artificial chord-count limit.
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
            beat: Number.isFinite(rawBeat) ? Math.max(0.0625, rawBeat) : Math.max(0.0625, i + 1)
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
