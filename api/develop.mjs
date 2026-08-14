export const runtime = 'nodejs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

const OPENAI_TIMEOUT_MS = 25000;

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: 'OPENAI_API_KEY is not configured in Vercel.' }, 500);

    const body = await request.json().catch(() => ({}));
    const lyrics = typeof body.lyrics === 'string' ? body.lyrics : '';
    const inspiration = typeof body.inspiration === 'string' ? body.inspiration : '';
    if (!lyrics.trim()) return json({ error: 'Lyrics are required.' }, 400);

    const bpmMatch = inspiration.match(/(?:around|about|at|near|roughly)?\s*(\d{2,3})\s*bpm\b/i);
    const requestedBpm = bpmMatch ? Number(bpmMatch[1]) : null;

    const systemPrompt = `You are SONGWRITER, a serious songwriting collaborator, arranger, and jazz-trained musician. You are NOT a chord-loop generator.

The user's lyrics are the source material. Preserve every non-empty lyric line VERBATIM and include every line exactly once. Never invent replacement lyrics, summaries, placeholders, or ellipses.

Develop a complete, convincing ORIGINAL song arrangement. Think about emotional arc, tension, release, repetition, variation, harmonic rhythm, phrasing, and form. Do not simply repeat four chords.

Use a sensible song form based on the actual material. Possible sections include Intro, Verse, Pre-Chorus, Chorus, Bridge, Turnaround, and Outro. Do not invent lyric lines merely to fill sections.

Think in bars. Each lyric line should have 1 or more bars, usually 2, 4, or 8. Each bar may contain 1-4 chord symbols. Vary harmonic rhythm intentionally. Different sections should have different harmonic roles when appropriate. Use functional harmony, ii-V motion, secondary dominants, borrowed chords, diminished passing chords, suspensions, pedal tones, deceptive resolutions, turnarounds, chromatic bass movement, or simpler harmony when appropriate. Complexity must serve the lyric.

Do not default to I-V-vi-IV unless the brief truly calls for it. Make the chorus feel like a payoff and a bridge provide contrast when those sections exist.

Artist/song references are high-level creative references only. Do not imitate a living artist's exact style or reproduce copyrighted lyrics or melodies. Translate references into broad characteristics such as intimacy, instrumentation, harmonic color, groove, phrasing, emotional temperature, density, and era.

${requestedBpm ? `The songwriter explicitly requested ${requestedBpm} BPM. Return bpm exactly ${requestedBpm}.` : 'Choose a musically appropriate BPM.'}

Return ONLY valid JSON matching the requested schema.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
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
                  sections: { type: 'array', minItems: 1, items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string' },
                      lines: { type: 'array', minItems: 1, items: {
                        type: 'object', additionalProperties: false,
                        properties: {
                          text: { type: 'string' },
                          bars: { type: 'array', minItems: 1, maxItems: 8, items: {
                            type: 'object', additionalProperties: false,
                            properties: {
                              chords: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
                              lyricCue: { type: 'string' }
                            },
                            required: ['chords', 'lyricCue']
                          } }
                        },
                        required: ['text', 'bars']
                      } }
                    },
                    required: ['name', 'lines']
                  } },
                  melody: { type: 'object', additionalProperties: false, properties: {
                    contour: { type: 'string' }, range: { type: 'string' }, rhythm: { type: 'string' }
                  }, required: ['contour', 'range', 'rhythm'] },
                  arrangement: { type: 'string' }
                },
                required: ['title', 'key', 'bpm', 'timeSignature', 'feel', 'sections', 'melody', 'arrangement']
              }
            }
          }
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') return json({ error: 'Song development timed out after 25 seconds. Try a shorter lyric draft.' }, 504);
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { return json({ error: `OpenAI returned an unexpected response (${response.status}).` }, 502); }
    if (!response.ok) return json({ error: data?.error?.message || `OpenAI request failed (${response.status}).` }, response.status);

    const text = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(part => part.type === 'output_text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');

    if (!text) return json({ error: 'The AI returned no usable song data.' }, 502);

    let song;
    try { song = JSON.parse(text); }
    catch { return json({ error: 'The AI returned malformed song data. Try again.' }, 502); }

    if (!song.sections?.length) return json({ error: 'The AI returned an incomplete song.' }, 502);
    if (requestedBpm) song.bpm = requestedBpm;
    return json(song);
  } catch (error) {
    console.error('Song development error:', error);
    return json({ error: error?.message || 'Song development failed. Please try again.' }, 500);
  }
}
