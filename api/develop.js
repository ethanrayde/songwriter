export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lyrics = '', inspiration = '' } = req.body || {};
    if (!lyrics.trim()) return res.status(400).json({ error: 'Lyrics are required.' });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: [
          {
            role: 'system',
            content: `You are Songwriter, a thoughtful songwriting collaborator. Develop the user's existing lyrics without replacing them. Treat artist references as high-level stylistic direction, not instructions to imitate a living artist exactly. Return ONLY valid JSON matching the requested schema. Make musically plausible choices. Keep the user's lyrics verbatim except for trimming whitespace. Infer sections from explicit labels or lyrical structure. Create a useful chord progression that supports the stated inspiration.\n\nJSON schema:\n{ "key": "string", "bpm": number, "timeSignature": "string", "feel": "string", "sections": [{ "name": "string", "lines": [{ "text": "string", "chords": ["string", "string", "string", "string"] }] }] }`
          },
          {
            role: 'user',
            content: `LYRICS:\n${lyrics}\n\nINSPIRATION / MUSICAL BRIEF:\n${inspiration || 'Choose a fitting musical direction that serves the lyrics.'}`
          }
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
                key: { type: 'string' },
                bpm: { type: 'number' },
                timeSignature: { type: 'string' },
                feel: { type: 'string' },
                sections: {
                  type: 'array',
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
                            chords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 }
                          },
                          required: ['text', 'chords']
                        }
                      }
                    },
                    required: ['name', 'lines']
                  }
                }
              },
              required: ['key', 'bpm', 'timeSignature', 'feel', 'sections']
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
