# Songwriter architecture

## Current
The GitHub Pages client is the writing room and lead-sheet editor. Lyrics and inspiration autosave locally in the browser. Development currently uses a deterministic fallback so the app works without an API.

## Next: AI development service
The production flow should be:

`Browser → /api/develop → AI model → structured Song JSON → Browser`

The browser should never contain an AI API key. Public GitHub Pages code is visible to anyone, so credentials must stay on a server-side function or other secret store.

### Planned Song JSON
```json
{
  "title": "",
  "key": "C",
  "bpm": 82,
  "timeSignature": "4/4",
  "inspiration": "",
  "sections": [
    {
      "name": "Verse",
      "lines": [
        {
          "lyrics": "",
          "chords": ["C", "Am", "F", "G"]
        }
      ]
    }
  ]
}
```

## AI behavior
The model should treat the user's lyrics as the primary creative material and the inspiration field as a direction/brief. It should not silently replace lyrics. It should propose structure, key, tempo, chord movement, and arrangement ideas, returning machine-readable JSON.

## Later
- Regenerate only one section or line.
- Ask for targeted changes such as “make the chorus more unresolved.”
- Audio preview with synthesized chords.
- Melody/rhythm sketch.
- Recording and overdub workflow.
- Song history/versioning.
- PWA/iPhone packaging.
