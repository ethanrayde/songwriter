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
    const density = String(body.harmonicDensity || 'Balanced');
    if (!lyrics.trim()) return res.status(400).json({ error: 'Lyrics are required.' });

    // Detect a pasted chord-chart row. This is intentionally deterministic: when the
    // user supplies a real chart, we do not ask the model to "remember" all of it.
    const chordToken = /^(?:[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?|N\.C\.)$/;
    const isChordToken = t => chordToken.test(t.replace(/[.,;:]+$/g, ''));
    const refRows = inspiration.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
      const tokens = line.split(/\s+/).map(t => t.replace(/[|]+/g, '').trim()).filter(Boolean);
      const chords = tokens.filter(isChordToken).map(t => t.replace(/[.,;:]+$/g, ''));
      const nonChord = tokens.filter(t => !isChordToken(t));
      // A chord-chart row is one where most meaningful tokens are chord symbols.
      return chords.length >= 3 && chords.length >= Math.max(3, nonChord.length) ? chords : null;
    }).filter(Boolean);

    const prompt = `You are the harmonic arranging brain inside a serious songwriter's lead-sheet studio.

ABSOLUTE RULE: THERE IS NO CHORD-COUNT LIMIT. Never reduce, summarize, or collapse harmony merely because a bar contains many events. A bar can contain 1, 2, 3, 4, 5, 6, 7, 8 or more chord events. Use the number required by the music.

REFERENCE-FIRST MODE:
If the user supplies a chord chart, it is authoritative. Preserve EVERY chord symbol in order, including every slash chord, inversion, extension, passing chord, and repeated chord. Do not simplify it. Do not turn it into a generic accompaniment. The supplied chart must survive into the JSON as individual chord events.

HARMONIC DENSITY: ${density}
${density === 'Dense' ? 'Use full harmonic vocabulary: walking basses, inversions, secondary dominants, diminished passing chords, extensions, chromatic approach chords and rich inner movement when musically justified. Dense means musically detailed, not random.' : ''}

TIMING:
- No two-chord-per-bar rule.
- No four-chord-per-bar rule.
- Chord events must have numeric beat positions such as 1, 1.5, 2, 2.5, 3, 3.5, 4.
- If a supplied chart has a sequence such as G Bm C Bm Am G C G, all 8 events must be represented. Spread them across the actual bar(s) rather than dropping events.
- A lyric line may span multiple bars.

LYRIC ALIGNMENT:
Preserve lyrics exactly. Every chord event has wordIndex (zero-based within the full lyric line) and beat. Several events may share the same wordIndex but must have distinct beats. NEVER concatenate chords into lyric text.

MUSICAL THINKING:
Use voice-leading and bass motion. Full walkdowns/walkups are welcome. Use maj7, m7, 7, 6, 9, add9, sus, 11, 13, diminished, secondary dominants, borrowed harmony and slash chords when appropriate. Do not add complexity without musical reason.

Return ONLY valid JSON:
{"title":"string","key":"string","bpm":78,"timeSignature":"4/4","feel":"string","sections":[{"name":"Verse 1","lines":[{"text":"exact lyric line","bars":[{"chords":[{"name":"C/E","wordIndex":0,"beat":1},{"name":"Am7/G","wordIndex":2,"beat":2.5}]}]}]}],"melody":{"contour":"string","range":"string","rhythm":"string"},"arrangement":"string"}

LYRICS:
${lyrics}

MUSICAL REFERENCE / INSPIRATION:
${inspiration || 'Organic singer-songwriter arrangement with tasteful harmonic movement.'}`;

    const requestBody = JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert arranger and lead-sheet editor. Never simplify a supplied chord chart. Return valid JSON only.' },
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

    // Normalize without imposing any chord limit.
    for (const section of song.sections) for (const line of (section.lines || [])) {
      const words = String(line.text || '').trim().split(/\s+/).filter(Boolean);
      const maxWord = Math.max(0, words.length - 1);
      for (const bar of (line.bars || [])) {
        bar.chords = (bar.chords || []).map((c, i) => {
          if (typeof c === 'string') return { name: c, wordIndex: Math.min(i, maxWord), beat: i + 1 };
          const wi = Number(c?.wordIndex), beat = Number(c?.beat);
          return { name: String(c?.name || ''), wordIndex: Number.isFinite(wi) ? Math.max(0, Math.min(Math.round(wi), maxWord)) : Math.min(i, maxWord), beat: Number.isFinite(beat) ? Math.max(0.0625, beat) : i + 1 };
        }).filter(c => c.name);
      }
    }

    // HARD REFERENCE PRESERVATION: if the inspiration contains explicit chord rows,
    // replace the model's simplified harmonic events with the exact supplied sequence.
    // This is the part that was missing in v0.17 and is why you kept getting 2 chords.
    if (refRows.length) {
      const lines = song.sections.flatMap(s => s.lines || []);
      for (let i = 0; i < Math.min(refRows.length, lines.length); i++) {
        const line = lines[i];
        const words = String(line.text || '').trim().split(/\s+/).filter(Boolean);
        const maxWord = Math.max(0, words.length - 1);
        const seq = refRows[i];
        // Keep the complete sequence in one or more bars. For a 4/4 chart, use up to
        // four quarter-note events per bar; eighth-note-density can therefore exceed it.
        const eventsPerBar = 4;
        line.bars = [];
        for (let j = 0; j < seq.length; j += eventsPerBar) {
          const chunk = seq.slice(j, j + eventsPerBar);
          line.bars.push({ chords: chunk.map((name, k) => ({
            name,
            wordIndex: Math.min(maxWord, Math.floor(((j + k) / Math.max(1, seq.length)) * Math.max(1, words.length))),
            beat: k + 1
          })) });
        }
      }
    }

    return res.status(200).json(song);
  } catch (error) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'OpenAI took too long to respond. Please try again.' });
    return res.status(500).json({ error: error?.message || 'Unexpected server error.' });
  }
}
