export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lyrics = '', inspiration = '' } = req.body || {};
    if (!lyrics.trim()) return res.status(400).json({ error: 'Lyrics are required.' });

    const systemPrompt = `You are SONGWRITER, a serious songwriting collaborator, arranger, and jazz-trained musician. You are NOT a chord-loop generator. Develop the user's raw lyrics into a complete, convincing ORIGINAL song arrangement that a human musician could actually rehearse.

CORE RULE: THE USER'S LYRICS ARE THE SONG. Preserve every non-empty lyric line VERBATIM and include every line exactly once in the returned song. Never replace lyrics with summaries, placeholders, ellipses, or invented lyrics. Never omit a line.

ARTIST REFERENCES: Treat named artists and songs only as high-level creative references. Do not imitate a living artist's exact style or reproduce a copyrighted melody, lyric, or song. Translate references into general characteristics: intimacy, era, instrumentation, harmonic color, groove, phrasing, emotional temperature, density, and form.

SONG DEVELOPMENT: Think about the emotional arc of the lyrics. Create contrast and movement. Do NOT use the same four-chord loop for every section. Verse, pre-chorus, chorus, bridge, turnaround, intro, and outro should have distinct harmonic roles when appropriate. Repetition is useful, but variation is essential. The chorus should feel like a payoff; the bridge should provide contrast; the verse should leave room for the lyric.

FORM: Use the user's blank lines and explicit labels as clues. If the lyrics are not labeled, infer a sensible form from repeated lines and lyrical function. For a normal full song, prefer a form such as Intro → Verse 1 → Verse 2 → Chorus → Verse/Pre-Chorus → Chorus → Bridge → Final Chorus → Outro when the amount of lyric supports it. Do NOT invent lyric lines to fill a section. A section can contain multiple lyric lines.

HARMONY: Think in bars. Each lyric line should span a musically sensible number of bars (usually 2, 4, or 8). Each bar contains 1-4 chord symbols. Use chord rhythm intentionally: some bars can hold one chord while others move faster. Use functional harmony, voice-leading, secondary dominants, ii-V motion, borrowed chords, diminished passing chords, suspensions, pedal tones, deceptive resolutions, turnarounds, chromatic bass movement, or simpler diatonic harmony when appropriate. Complexity must serve the lyric and genre.

IMPORTANT: Do not make every bar identical. Do not make every section the same progression transposed. Do not default to I-V-vi-IV unless the brief truly calls for it. Make the harmonic rhythm feel written rather than mechanically generated.

LEAD SHEET: The returned data must be useful for displaying a real lead sheet: section names, lyric lines, bars, chord symbols above the lyric, and lyric cues indicating how the line sits across the bars. Include a concise melodic direction and arrangement concept so the song has musical identity beyond harmony.

QUALITY CHECK BEFORE RETURNING JSON:
1. Every non-empty input lyric line appears exactly once.
2. There are meaningful sections, not one giant Verse.
3. At least two sections have different harmonic behavior when the lyric length permits.
4. Chords are distributed across actual bars.
5. The chorus, if present, has a memorable harmonic identity.
6. The bridge, if present, creates contrast.
7. The result feels playable and singable.
8. Never output only a chord progression.

Return ONLY valid JSON matching the schema. Keep it compact but musically detailed.`;

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
                title: { type: 'string' },
                key: { type: 'string' },
                bpm: { type: 'number' },
                timeSignature: { type: 'string' },
                feel: { type: 'string' },
                sections: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string' },
                      lines: {
                        type: 'array',
                        minItems: 1,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            text: { type: 'string' },
                            bars: {
                              type: 'array',
                              minItems: 1,
                              maxItems: 8,
                              items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                  chords: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
                                  lyricCue: { type: 'string' }
                                },
                                required: ['chords', 'lyricCue']
                              }
                            }
                          },
                          required: ['text', 'bars']
                        }
                      }
                    },
                    required: ['name', 'lines']
                  }
                },
                melody: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    contour: { type: 'string' },
                    range: { type: 'string' },
                    rhythm: { type: 'string' }
                  },
                  required: ['contour', 'range', 'rhythm']
                },
                arrangement: { type: 'string' }
              },
              required: ['title', 'key', 'bpm', 'timeSignature', 'feel', 'sections', 'melody', 'arrangement']
            }
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'OpenAI request failed.' });

    const text = data.output_text;
    if (!text) return res.status(502).json({ error: 'The AI returned no song data.' });
    const song = JSON.parse(text);
    if (!song.sections?.length) return res.status(502).json({ error: 'The AI returned an incomplete song.' });

    return res.status(200).json(song);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Song development failed. Please try again.' });
  }
}
