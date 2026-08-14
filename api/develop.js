export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rawKey = process.env.OPENAI_API_KEY;
  if (!rawKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in Vercel.' });
  const key = rawKey.trim().replace(/^['\"]|['\"]$/g, '');
  if (!key || /[^\x20-\x7E]/.test(key)) return res.status(500).json({ error: 'OPENAI_API_KEY contains a non-ASCII character. Re-enter the API key in Vercel Environment Variables.' });
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const prompt = String(body.prompt ?? '').trim();
    const density = String(body.harmonicDensity || 'Insane');
    if (!prompt) return res.status(400).json({ error: 'Describe the music you want first.' });
    const densityMap = {Simple:'Keep harmony economical and songlike.',Balanced:'Use tasteful extensions, inversions and clear voice-leading.',Rich:'Use frequent 7ths, 9ths, slash chords, secondary dominants, diminished connectors and chromatic bass motion.',Dense:'Favor active harmonic rhythm, full bass walkdowns and walkups, chromatic passing harmony, secondary dominants, diminished connectors, borrowed harmony and rich extensions.',Insane:'Make harmonic sophistication a primary compositional goal. Explore maximum coherent movement with chromatic bass lines, inversions, altered dominants, diminished passing chords, tonicizations, borrowed harmony, chromatic mediants, sus resolutions, upper extensions and moving inner voices. Use as many harmonic events per bar as musically useful—there is absolutely no two-chord or four-chord limit. Never simplify a progression merely to make it shorter.'};
    const system = `You are SONGWRITER, a world-class harmonic composer and professional lead-sheet editor. You are not a lyric generator. Create an exceptional, playable chord chart from a natural-language musical brief. Think like a composer, arranger, jazz pianist, songwriter and engraver simultaneously. The user wants a chord chart ONLY: no lyrics. Build a complete song form with real musical development, not a generic loop. HARMONIC MANDATE: ${densityMap[density] || densityMap.Insane}

COMPOSITION RULES:
- Build a deliberate form: Intro, Verse, Pre-Chorus, Chorus, Bridge, Outro or other sections when appropriate.
- Give every bar a meter-aware sequence of chord events. There is NO chord-count limit.
- Each chord event has a precise beat from 1 through 4. Quarter positions may be 1,2,3,4; eighth positions 1.5,2.5,3.5; sixteenth positions 1.25,1.5,1.75, etc.
- Use slash chords for intentional bass lines. Favor complete walkdowns/walkups when they improve the phrase.
- Use 7ths, maj7, m7, 9ths, 11ths, 13ths, sus chords, altered dominants, diminished passing chords, secondary dominants, borrowed chords and chromatic approach harmony when justified.
- Maintain strong voice-leading and active inner voices.
- Avoid random complexity. Every surprising chord should have a reason.
- Make sections meaningfully different. Avoid four-chord-loop syndrome.
- Maintain tonal gravity even when adventurous.
- Make the chart playable by a strong pianist/guitarist.
- Include repeats and navigation instructions when useful.
- Prefer conventional chord symbols musicians can read instantly.
- Use bar-level chord rhythm to communicate timing.

OUTPUT ONLY VALID JSON: {"title":"string","key":"C","bpm":78,"timeSignature":"4/4","feel":"string","difficulty":"string","sections":[{"name":"Intro","bars":[{"number":1,"chords":[{"name":"Cmaj7","beat":1},{"name":"C/B","beat":3},{"name":"Am9","beat":4}]}]}],"navigation":"string","performanceNotes":["string"],"arrangement":"string"}
Return enough bars to feel complete, normally 16–64 bars depending on the requested form. No placeholder bars. No lyrics anywhere.`;
    const requestBody = JSON.stringify({model:'gpt-4o-mini',temperature:0.55,max_tokens:9000,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:prompt}]});
    const controller = new AbortController(); const timeout=setTimeout(()=>controller.abort(),25000); let response;
    try { response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8',Authorization:'Bearer '+key,Accept:'application/json'},body:requestBody,signal:controller.signal}); } finally { clearTimeout(timeout); }
    const raw=await response.text(); let payload=null; try{payload=JSON.parse(raw)}catch{}
    if(!response.ok){const message=payload?.error?.message||`OpenAI returned HTTP ${response.status}.`;if(response.status===429)return res.status(429).json({error:'OpenAI rejected the request because of quota or rate limits. Check API billing/usage and try again.'});return res.status(502).json({error:message});}
    const content=payload?.choices?.[0]?.message?.content;if(!content)return res.status(502).json({error:'OpenAI returned an empty response.'});
    let song;try{song=JSON.parse(content)}catch{return res.status(502).json({error:'OpenAI returned invalid chart JSON. Try again.'});}
    if(!song.title||!song.key||!Array.isArray(song.sections)||!song.sections.length)return res.status(502).json({error:'AI returned an incomplete chord chart. Try again.'});
    for(const section of song.sections) section.bars=(section.bars||[]).map((bar,i)=>({number:Number(bar.number)||i+1,chords:(bar.chords||[]).map((c,j)=>({name:String(c?.name||''),beat:Number(c?.beat)||Math.min(4,j+1)})).filter(c=>c.name)}));
    return res.status(200).json(song);
  } catch(error){if(error?.name==='AbortError')return res.status(504).json({error:'The composer took too long to respond. Please try again.'});return res.status(500).json({error:error?.message||'Unexpected server error.'});}
}
