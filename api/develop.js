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
    const densityInstructions = {
      Simple: 'Use restrained harmony, but allow necessary passing movement.',
      Balanced: 'Use tasteful extensions, inversions, secondary dominants and smooth voice-leading.',
      Rich: 'Use frequent extensions, slash chords, secondary dominants, diminished connectors, chromatic bass movement and active inner voices.',
      Dense: 'Use highly active harmonic rhythm, full walkdowns and walkups, chromatic passing harmony, secondary dominants, diminished connectors, borrowed harmony, rich extensions and detailed inner voice-leading whenever musically justified.',
      Insane: 'Treat harmonic sophistication as a primary compositional goal. Explore maximum coherent movement: chromatic bass lines, inversions, secondary dominants, diminished passing chords, altered dominants, tonicizations, borrowed harmony, upper extensions, sus resolutions, chromatic mediants and moving inner voices. A 4/4 bar may contain 1, 2, 3, 4, 5, 6, 7, 8 or more harmonic events. Never simplify music just to reduce chord count. Complexity must remain intentional and playable.'
    };
    const prompt = `You are the harmonic arranging and lead-sheet brain inside a serious songwriter studio. Turn raw lyrics and musical intent into a genuinely musical, sophisticated, performable song.

HARD RULES:\n- THERE IS NO CHORD-COUNT LIMIT.\n- Never collapse harmony merely because a bar contains many events.\n- Chord events may occur on 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5 and, when needed, sixteenth-note positions such as 1.25 or 1.75.\n- Every chord event MUST have an exact numeric beat and a wordIndex.\n- Multiple events may share a wordIndex but must have different beats.\n- Preserve lyric text exactly.\n\nREFERENCE-FIRST MODE:\nIf the inspiration contains a chord chart, it is authoritative. Preserve EVERY supplied chord symbol in EXACT order, including slash chords, inversions, extensions and passing chords. Never simplify it. Every supplied chord must survive as its own JSON event.\n\nHARMONIC DENSITY: ${density}\n${densityInstructions[density] || densityInstructions.Balanced}\n\nRHYTHMIC/HARMONIC ALIGNMENT:\nThink in a visible 4/4 grid. Chord changes should land on the lyric word or syllable where the harmonic change is intended. The frontend will display the beat grid, so give precise beats. Do not concatenate chord symbols into lyric text.\n\nMUSICAL THINKING:\nPrioritize voice-leading and bass motion. Use maj7, m7, 7, 6, 9, add9, sus, 11, 13, altered dominants, diminished passing chords, secondary dominants, borrowed harmony, chromatic approach chords, tonicizations and slash chords when appropriate. Full descending or ascending bass patterns are encouraged when they strengthen the phrase. Make sections harmonically distinct. Compose harmony that supports a coherent singable melody and natural lyric phrasing.\n\nSONG ARCHITECTURE:\nDevelop complete sections with contrast. Avoid repeating a generic four-chord loop unless musically intentional.\n\nReturn ONLY valid JSON:\n{"title":"string","key":"string","bpm":78,"timeSignature":"4/4","feel":"string","genre":"string","sections":[{"name":"Verse 1","lines":[{"text":"exact lyric line","bars":[{"chords":[{"name":"C/E","wordIndex":0,"beat":1},{"name":"Am7/G","wordIndex":2,"beat":2.5}]}]}]}],"melody":{"contour":"string","range":"string","rhythm":"string"},"arrangement":"string"}\n\nIMPORTANT: bars are only grouping. They are NOT a chord limit.\n\nLYRICS:\n${lyrics}\n\nMUSICAL REFERENCE / INSPIRATION:\n${inspiration || 'Organic singer-songwriter arrangement with expressive harmonic movement.'}`;
    const requestBody = JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.35, max_tokens: 8000, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'You are an expert composer, arranger, harmonic analyst and lead-sheet editor. Musical quality and exact chord-event alignment are more important than brevity. Return valid JSON only.' },
      { role: 'user', content: prompt }
    ]});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let response;
    try { response = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json; charset=utf-8','Authorization':'Bearer '+key,'Accept':'application/json'}, body:requestBody, signal:controller.signal }); }
    finally { clearTimeout(timeout); }
    const raw = await response.text();
    let payload = null; try { payload = JSON.parse(raw); } catch {}
    if (!response.ok) { const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}.`; if (response.status === 429) return res.status(429).json({ error:'OpenAI rejected the request because of quota or rate limits. Check API billing/usage and try again.' }); return res.status(502).json({ error:message }); }
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error:'OpenAI returned an empty response.' });
    let song; try { song = JSON.parse(content); } catch { return res.status(502).json({ error:'OpenAI returned invalid song JSON. Try again.' }); }
    if (!song.title || !song.key || !Array.isArray(song.sections) || !song.sections.length) return res.status(502).json({ error:'AI returned an incomplete song. Try again.' });
    for (const section of song.sections) for (const line of (section.lines || [])) {
      const words = String(line.text || '').trim().split(/\s+/).filter(Boolean), maxWord=Math.max(0,words.length-1);
      for (const bar of (line.bars || [])) bar.chords=(bar.chords||[]).map((c,i)=>{ if(typeof c==='string') return {name:c,wordIndex:Math.min(i,maxWord),beat:i+1}; const wi=Number(c?.wordIndex),beat=Number(c?.beat); return {name:String(c?.name||''),wordIndex:Number.isFinite(wi)?Math.max(0,Math.min(Math.round(wi),maxWord)):Math.min(i,maxWord),beat:Number.isFinite(beat)?Math.max(.0625,beat):i+1}; }).filter(c=>c.name);
    }
    if(refRows.length){
      const lines=song.sections.flatMap(s=>s.lines||[]);
      for(let i=0;i<Math.min(refRows.length,lines.length);i++){
        const line=lines[i], words=String(line.text||'').trim().split(/\s+/).filter(Boolean), maxWord=Math.max(0,words.length-1), seq=refRows[i];
        line.bars=[];
        for(let j=0;j<seq.length;j+=4) line.bars.push({chords:seq.slice(j,j+4).map((name,k)=>({name,wordIndex:Math.min(maxWord,Math.floor(((j+k)/Math.max(1,seq.length))*Math.max(1,words.length))),beat:k+1}))});
      }
    }
    return res.status(200).json(song);
  } catch(error) { if(error?.name==='AbortError') return res.status(504).json({error:'OpenAI took too long to respond. Please try again.'}); return res.status(500).json({error:error?.message||'Unexpected server error.'}); }
}
