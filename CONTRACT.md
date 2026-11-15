# THE BRASS VESSEL — build contract

An interactive, narrated, ~2-hour "occult podcast" in the browser that walks a complete
beginner through the *Lesser Key of Solomon* (the Lemegeton), starting from its first book,
the *Ars Goetia* and its 72 spirits. Twelve episodes of ~10 minutes each. Plain HTML/CSS/JS,
no frameworks, no CDN, no downloaded assets. Served by a local static server.

Framing: this is history, folklore and literature, told like a late-night audio documentary.
It is honest (says what is legend, what is manuscript fact, what is 19th-century invention),
never preachy, never a how-to for anything harmful. The pull comes from atmosphere, story
and curiosity, not from pretending the magic is proven.

## Files and owners (never write outside your own paths)

| Path | Owner |
|---|---|
| `index.html`, `css/style.css`, `js/app.js`, `build/*` | lead |
| `data/canon.json` | canon agent |
| `js/sigils.js` | sigil agent |
| `js/ambience.js` | ambience agent |
| `js/scenes.js` | scenes agent |
| `episodes/epNN.json` | writer for episode NN |

## Voices

- `keeper` — the host. A woman's voice. Warm, dry, a little ominous. Speaks to "you".
  Short sentences that sound good aloud. Podcast habits: cold opens, callbacks, "stay with me".
- `book` — a second, male, British voice that only ever *reads from the old texts*
  (Goetia 1904 Mathers/Crowley edition, Weyer 1577, Scot 1584, Testament of Solomon — all
  public domain). Use it for real quotations or very close paraphrase in period style, 15–60 words.

## Episode JSON schema (`episodes/epNN.json`)

```json
{
  "id": "ep05", "num": 5,
  "title": "The Kings", "subtitle": "Nine crowns and the manners of Hell",
  "blurb": "One sentence for the episode list.",
  "mood": "court", "scene": "court",
  "segments": [
    {"v": "keeper", "t": "Spoken paragraph, 30–110 words."},
    {"v": "book", "t": "Quoted passage.", "src": "Goetia (1904), spirit 9"},
    {"v": "keeper", "t": "…", "spirit": 9},
    {"v": "keeper", "t": "…", "mood": "storm", "scene": "storm"},
    {"v": "keeper", "t": "…", "term": "triangle-of-art"},
    {"threshold": {"id": "ep05-t1", "q": "Question the Keeper asks the listener (also spoken).",
      "opts": [
        {"key": "a", "label": "2–6 word button", "trait": "scholar", "reply": "Keeper's spoken answer to this choice, 35–70 words."},
        {"key": "b", "label": "…", "trait": "seeker", "reply": "…"},
        {"key": "c", "label": "…", "trait": "skeptic", "reply": "…"}
      ]}}
  ],
  "glossary": [{"id": "triangle-of-art", "term": "Triangle of Art", "def": "One or two plain sentences."}]
}
```

Rules:
- `spirit: N` (1–72) on a segment makes that spirit's card "manifest" in the listener's grimoire
  the moment the segment starts. Put it on the segment where the spirit is first properly introduced.
  Every spirit assigned to the episode must appear exactly once as a `spirit` cue.
- `mood` / `scene` on a segment changes sound / backdrop from that segment on. Allowed values for both:
  `crypt`, `library`, `court`, `storm`, `sea`, `fire`, `void`, `dawn`.
- `term` unlocks a glossary entry; its id must exist in this episode's `glossary`.
- Exactly 2 thresholds per episode (roughly at 1/3 and 2/3). 2–3 options each. `trait` is one of
  `scholar`, `seeker`, `skeptic`, `poet`. Replies must not change what comes after (the main
  narration continues the same either way), so write the following segment to work after any reply.
- Text is spoken by a speech synthesizer: no markdown, no emoji, no parentheses-heavy asides,
  no abbreviations like "c." or "MS."; write numbers the way they should be said only when it
  matters ("fifteen seventy-seven" for years is good). Spell spirit names exactly as in canon.
- All facts about the 72 spirits (rank, legions, appearance, office) come from `data/canon.json`.

## canon.json schema

```json
{"source": "…", "spirits": [
  {"n": 9, "name": "Paimon", "alt": ["Paymon"], "rank": ["King"], "legions": 200,
   "appearance": "One or two sentences.", "office": "One or two sentences on what he is said to do.",
   "quote": "A short verbatim line from the 1904 text (max 40 words).",
   "say": "PIE-mon", "element": "optional note", "episode": 5}
]}
```

## Episode plan and spirit assignment (n = spirit number in the Goetia)

1. The Brass Vessel — Solomon, the ring, the sealed vessel, the lake; what this book is. Spirits: 1
2. A Book With Five Doors — the five books of the Lemegeton, the manuscripts, the first pages. Spirits: 2, 3, 4
3. The Circle and the Triangle — the apparatus and its logic of safety. Spirits: 13, 29
4. The Courts of Hell — ranks, legions, metals, the four kings of the quarters. Spirits: 17, 21, 22, 25, 27, 33, 50
5. The Kings — Spirits: 9, 20, 32, 45, 51, 61, 68
6. The Faculty — demons as teachers, doctors, librarians. Spirits: 5, 8, 10, 11, 24, 31, 36, 48, 53, 55, 58, 60
7. Lovers, Liars and Thieves — Spirits: 6, 12, 14, 15, 16, 19, 34, 40, 44, 47, 56, 63
8. The Bestiary — the strangest and most beautiful shapes. Spirits: 30, 35, 37, 41, 42, 49, 59, 62, 64, 65, 67, 69
9. Older Than Hell — how gods became demons (Baal, Astarte, Aeshma, Amun). Spirits: 7, 26, 28, 46, 54
10. The Men Who Opened the Book — Weyer, Scot, the copyists, Mathers and Crowley. Spirits: 18, 23, 38, 39
11. The Demon in the Mirror — psychology, pop culture, scepticism, why it still pulls. Spirits: 52, 57, 66, 71
12. The License to Depart — the last names, closing the circle, where to read next. Spirits: 43, 70, 72

## Visual language (for anything that draws)

Near-black violet background `#07060a`, bone ink `#efe6d6`, dim `#8b8496`, brass `#c9a45c`,
ember `#d9542b`, blood `#8e1b2e`, ultraviolet `#8f6bff`. Thin engraved lines, woodcut feel,
slow motion. Serif `"Iowan Old Style", Palatino, Georgia, serif`; labels in small-caps mono
`ui-monospace, "SF Mono", Menlo, monospace` with wide letter-spacing.
