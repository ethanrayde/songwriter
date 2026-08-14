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

    const chordToken = /^(?:[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?|N\.C\.)$/;
    const isChordToken = t => chordToken.test(t.replace(/[.,;:]+$/g, ''));
    const refRows = inspiration.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
      const tokens = line.split(/\s+/).map(t => t.replace(/[|]+/g, '').trim()).filter(Boolean);
      const chords = tokens.filter(isChordToken).map(t => t.replace(/[.,;:]+$/g, ''));
      const nonChord = tokens.filter(t => !isChordToken(t));
      return chords.length >= 3 && chords.length >= Math.max(3, nonChord.length) ? chords : null;
    }).filter(Boolean);

    const prompt = `You are the composition and arranging brain of a professional lead-sheet studio. Your job is to turn raw lyrics and musical intent into a genuinely musical, performable song—not a generic four-chord demo.

CORE REQUIREMENT — MUSICAL DEVELOPMENT:
Analyze the lyric phrasing, implied melody, harmonic rhythm, bass movement, inner voices, cadences, tension/release, and section architecture BEFORE choosing chords. Compose harmony phrase-by-phrase. Do not default to one chord at the beginning and one at the end of every lyric line.

ABSOLUTE HARMONIC RULE:
THERE IS NO CHORD-COUNT LIMIT. A 4/4 bar may contain 1, 2, 3, 4, 5, 6, 7, 8 or more harmonic events when musically justified. Never collapse events merely to fit a template. Chord changes may occur on beats 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, etc. Use fractional beats for anticipations and faster harmonic rhythm.

REFERENCE-FIRST MODE:
If the user supplies an explicit chord chart, treat it as authoritative musical evidence. Preserve EVERY supplied chord in EXACT order, including slash chords, inversions, extensions, passing chords and repeated chords. Never replace a supplied progression with a generic approximation. The progression must survive as individual JSON chord events.

HARMONIC DENSITY: ${density}
${density === 'Simple' ? 'Use restrained harmony, but still allow necessary passing movement.' : density === 'Balanced' ? 'Use tasteful extensions, inversions, secondary dominants and voice-leading.' : density === 'Rich' ? 'Use frequent extensions, inversions, passing harmony, secondary dominants, chromatic bass movement and strong voice-leading.' : 'Use sophisticated, highly detailed harmony: full walkdowns/walkups, chromatic passing chords, secondary dominants, diminished passing chords, substitutions, rich 7ths/9ths/11ths/13ths, slash chords, contrary motion and active inner voices whenever they improve the phrase. Dense means intentional, not random.'}

LEAD-SHEET ALIGNMENT:
The lead sheet is the primary product. Each chord event MUST have a numeric beat and a wordIndex. Several chord events may attach to the same lyric word if they happen during that word. Chords must visually appear directly above the lyric word/syllable where they occur. NEVER concatenate chord symbols into lyric text. NEVER move all later chords to the end of a line.

VOICE LEADING:
Think like an arranger. Favor economical movement between chord tones. If a bass line naturally descends chromatically or diatonically, use slash chords/inversions to expose it. Use extensions to make inner voices sing. Harmonic complexity should create audible motion, not random chord-name variety.

SONG ARCHITECTURE:
Develop complete sections with contrast. Do not generate only a verse unless the supplied material genuinely contains only a verse. Suggest/construct chorus, bridge, pre-chorus or instrumental contrast when appropriate. Avoid repeating the exact same four-chord loop unless the musical idea specifically calls for it.

MELODY:
Create a coherent, singable melodic concept that interacts with the harmony. Do not merely describe a scale. Consider phrase peaks, approach tones, chord tones on strong beats, passing tones, rests, rhythmic variation and melodic contrast between sections.

REFERENCE STYLE SAFETY:
When the user names an artist, analyze high-level musical characteristics (era, instrumentation, harmonic language, groove, melodic contour, arrangement techniques) rather than attempting an exact imitation of a living artist's distinctive style. If the reference is a specific song supplied by the user, use the user's supplied chord chart as factual harmonic reference.

OUTPUT:
Return ONLY valid JSON matching exactly this shape:
{"title":"string","key":"string","bpm":78,"timeSignature":"4/4","feel":"string","genre":"string","sections":[{"name":"Verse 1","lines":[{"text":"exact lyric line","bars":[{"chords":[{"name":"C/E","wordIndex":0,"beat":1},{"name":"Am7/G","wordIndex":2,"beat":2.5}]}]}]}],"melody":{"contour":"string","range":"string","rhythm":"string"},"arrangement":"string"}

IMPORTANT: The bars array is only a grouping mechanism. It is NOT a limit. Put as many chord events into each bar as the music needs. Use the actual lyric text exactly.

LYRICS:
${lyrics}

MUSICAL REFERENCE / INSPIRATION:
${inspiration || 'Organic singer-songwriter arrangement with expressive harmonic movement.'}`;

    const requestBody = JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert composer, arranger, harmonic analyst and lead-sheet editor. Musical quality and exact chord-event alignment are more important than brevity. Return valid JSON only.' },
        { role: 'user', content: prompt }
      ]
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json; charset=utf-8','Authorization':'Bearer '+key,'Accept':'application/json'}, body:requestBody, signal:controller.signal });
    } finally { clearTimeout(timeout); }
    const raw = await response.text();
    let payload = null; try { payload = JSON.parse(raw); } catch {}
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}.`;
      if (response.status === 429) return res.status(429).json({ error:'OpenAI rejected the request because of quota or rate limits. Check API billing/usage and try again.' });
      return res.status(502).json({ error:message });
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error:'OpenAI returned an empty response.' });
    let song; try { song = JSON.parse(content); } catch { return res.status(502).json({ error:'OpenAI returned invalid song JSON. Try again.' }); }
    if (!song.title || !song.key || !Array.isArray(song.sections) || !song.sections.length) return res.status(502).json({ error:'AI returned an incomplete song. Try again.' });

    for (const section of song.sections) for (const line of (section.lines || [])) {
      const words = String(line.text || '').trim().split(/\s+/).filter(Boolean), maxWord=Math.max(0,words.length-1);
      for (const bar of (line.bars || [])) bar.chords=(bar.chords||[]).map((c,i)=>{
        if(typeof c==='string') return {name:c,wordIndex:Math.min(i,maxWord),beat:i+1};
        const wi=Number(c?.wordIndex),beat=Number(c?.beat);
        return {name:String(c?.name||''),wordIndex:Number.isFinite(wi)?Math.max(0,Math.min(Math.round(wi),maxWord)):Math.min(i,maxWord),beat:Number.isFinite(beat)?Math.max(.0625,beat):i+1};
      }).filter(c=>c.name);
    }

    // If the user supplied a chord chart, enforce every supplied event server-side.
    if(refRows.length){
      const lines=song.sections.flatMap(s=>s.lines||[]);
      for(let i=0;i<Math.min(refRows.length,lines.length);i++){
        const line=lines[i], words=String(line.text||'').trim().split(/\s+/).filter(Boolean), maxWord=Math.max(0,words.length-1), seq=refRows[i];
        line.bars=[];
        // Do not collapse the reference. Every chord remains a separate event.
        for(let j=0;j<seq.length;j+=4){
          line.bars.push({chords:seq.slice(j,j+4).map((name,k)=>({name,wordIndex:Math.min(maxWord,Math.floor(((j+k)/Math.max(1,seq.length))*Math.max(1,words.length))),beat:k+1}))});
        }
      }
    }
    return res.status(200).json(song);
  } catch(error) {
    if(error?.name==='AbortError') return res.status(504).json({error:'OpenAI took too long to respond. Please try again.'});
    return res.status(500).json({error:error?.message||'Unexpected server error.'});
  }
}
