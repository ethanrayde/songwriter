export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in Vercel.' });
    }

    const { lyrics = '', inspiration = '' } = req.body || {};
    if (!lyrics.trim()) return res.status(400).json({ error: 'Lyrics are required.' });

    const systemPrompt = `You are SONGWRITER, a serious songwriting collaborator, arranger, and jazz-trained musician. You are NOT a chord-loop generator. Develop the user's raw lyrics into a complete, convincing ORIGINAL song arrangement that a human musician could actually rehearse.

CORE RULE: THE USER'S LYRICS ARE THE SONG. Preserve every non-empty lyric line VERBATIM and include every line exactly once in the returned song. Never replace lyrics with summaries, placeholders, ellipses, or invented lyrics. Never omit a line.

ARTIST REFERENCES: Treat named artists and songs only as high-level creative references. Do not imitate a living artist's exact style or reproduce a copyrighted melody, lyric, or song. Translate references into general characteristics: intimacy, era, instrumentation, harmonic color, groove, phrasing, emotional temperature, density, and form.

SONG DEVELOPMENT: Think about the emotional arc of the lyrics. Create contrast and movement. Do NOT use the same four-chord loop for every section. Verse, pre-chorus, chorus, bridge, turnaround, intro, and outro should have distinct harmonic roles when appropriate. Repetition is useful, but variation is essential. The chorus should feel like a payoff; the bridge should provide contrast; the verse should leave room for the lyric.

FORM: Use blank lines and explicit labels as clues. If lyrics are not labeled, infer a sensible form from repeated lines and lyrical function. Use as many sections as the lyric material actually supports. Do NOT invent lyric lines to fill a section.

HARMONY: Think in bars. Each lyric line should span a musically sensible number of bars (usually 2, 4, or 8). Each bar contains 1-4 chord symbols. Use chord rhythm intentionally: some bars can hold one chord while others move faster. Use functional harmony, voice-leading, secondary dominants, ii-V motion, borrowed chords, diminished passing chords, suspensions, pedal tones, deceptive resolutions, turnarounds, chromatic bass movement, or simpler diatonic harmony when appropriate. Complexity must serve the lyric and genre.

IMPORTANT: Do not make every bar identical. Do not make every section the same progression. Do not default to I-V-vi-IV unless the brief truly calls for it. Make the harmonic rhythm feel written rather than mechanically generated.

LEAD SHEET: Return section names, lyric lines, bars, chord symbols above the lyric, and lyric cues indicating how the line sits across the bars. Include concise melodic direction and an arrangement concept.

QUALITY CHECK: Every lyric line exactly once; meaningful sections; contrasting harmonic behavior where appropriate; chords distributed across actual bars; chorus has identity; bridge creates contrast if present; playable and singable; never output only a chord progression.

Return ONLY valid JSON matching the schema.`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `RAW LYRICS:\n${lyrics}\n\nINSPIRATION / MUSICAL BRIEF:\n${inspiration || 'Choose a fitting musical direction that serves the lyrics.'}` }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'song_development',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' }, key: { type: 'string' }, bpm: { type: 'number' }, timeSignature: { type: 'string' }, feel: { type: 'string' },
                sections: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: {
                  name: { type: 'string' }, lines: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: {
                    text: { type: 'string' }, bars: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, properties: {
                      chords: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } }, lyricCue: { type: 'string' }
                    }, required: ['chords', 'lyricCue'] } }
                  }, required: ['text', 'bars'] } }
                }, required: ['name', 'lines'] } },
                melody: { type: 'object', additionalProperties: false, properties: { contour: { type: 'string' }, range: { type: 'string' }, rhythm: { type: 'string' } }, required: ['contour', 'range', 'rhythm'] },
                arrangement: { type: 'string' }
              },
              required: ['title', 'key', 'bpm', 'timeSignature', 'feel', 'sections', 'melody', 'arrangement']
            }
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || `OpenAI request failed (${response.status}).` });

    // The REST Responses API returns generated text inside output[].content[].text.
    // output_text is an SDK convenience property and is not guaranteed in raw REST JSON.
    const text = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(part => part.type === 'output_text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');

    if (!text) return res.status(502).json({ error: 'The AI returned no usable song data.' });

    let song;
    try { song = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'The AI returned malformed song data. Try again.' }); }

    if (!song.sections?.length) return res.status(502).json({ error: 'The AI returned an incomplete song.' });
    return res.status(200).json(song);
  } catch (error) {
    console.error('Song development error:', error);
    return res.status(500).json({ error: error?.message || 'Song development failed. Please try again.' });
  }
}
