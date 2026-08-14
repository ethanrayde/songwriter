export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lyrics = '', inspiration = '' } = req.body || {};
    if (!lyrics.trim()) return res.status(400).json({ error: 'Lyrics are required.' });

    const systemPrompt = `You are SONGWRITER, an expert songwriting collaborator, arranger, and jazz-trained harmonic musician. Your job is to turn the user's raw lyrics and musical brief into a convincing, playable ORIGINAL song plan.

Do not rewrite, summarize, or omit the user's lyrics. Preserve every non-empty lyric line verbatim. You may infer section names from formatting or lyrical function, but never invent lyric text.

Artist references are creative references only. Do not imitate a living artist's exact style or reproduce any copyrighted song. Instead, translate references into high-level musical characteristics such as intimacy, harmonic language, instrumentation, groove, phrasing, era, density, or emotional character.

Think like a real songwriter, not a chord generator. A song should have DEVELOPMENT. Avoid repeating one four-chord loop across the entire song. Use different harmonic behavior for verse, pre-chorus, chorus, bridge, turnaround, intro, and outro when appropriate. Let the harmony follow the emotional arc of the lyrics.

Use practical musical grammar. Depending on the brief, you may use ii-V motion, secondary dominants, tonicizations, diminished passing chords, modal interchange, borrowed iv, backdoor dominants, tritone substitutions, chromatic approach chords, suspended chords, pedal tones, deceptive resolutions, turnarounds, or simpler diatonic writing. Do not add complexity merely to show off. Keep the result singable and playable.

Think in BARS, not merely one chord per lyric line. A typical lyric line can span 2, 4, or 8 bars. Put 1-4 chords in a bar and vary chord rhythm where musically appropriate. Chorus harmony should usually have a clear identity rather than simply copying the verse. A bridge should create contrast. An intro/outro is optional.

Use the supplied lyrics' line breaks as the primary lyric units. If the user has blank lines, use them as clues for sections. If explicit labels such as VERSE, CHORUS, BRIDGE, or PRE-CHORUS exist, preserve them.

Use public-domain jazz repertoire and general jazz harmony as a conceptual reference when useful, but do not reproduce any particular copyrighted lead sheet. The goal is to learn the LANGUAGE of standards: functional harmony, melodic space, turnarounds, voice-leading, contrast, and form.

Return ONLY valid JSON matching the schema. Keep the JSON compact but musically detailed.

Schema meaning:
- title: a concise working title inferred from the lyrics; never invent a lyric phrase if an obvious title exists.
- key: concert key.
- bpm: realistic integer.
- timeSignature: normally 4/4 unless the lyrics strongly suggest otherwise.
- feel: one or two sentences describing groove/arrangement.
- sections: the complete song form.
- each line has text plus bars.
- each bar has chords (1-4 chord symbols) and optional lyricCue describing where that lyric line sits rhythmically. Do not put lyrics into lyricCue.
- melody: high-level melodic guidance only, not a copyrighted melody; include contour, range, and syllable/rhythm approach.
- arrangement: concise instrumentation and dynamics by section.`;

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
          { role: 'user', content: `LYRICS:\n${lyrics}\n\nINSPIRATION / MUSICAL BRIEF:\n${inspiration || 'Choose a fitting musical direction that serves the lyrics.'}` }
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
    return res.status(200).json(JSON.parse(text));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Song development failed. Please try again.' });
  }
}
