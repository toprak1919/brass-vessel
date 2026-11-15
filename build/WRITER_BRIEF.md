# Writer brief (shared by all episode writers)

You are one of twelve writers on THE BRASS VESSEL, an interactive narrated "occult podcast" for complete
beginners about the Lesser Key of Solomon. Read, in this order:
1. `CONTRACT.md` (schema, voices, rules, episode plan, your spirit assignment)
2. `episodes/ep01.json` (the finished model episode: copy its tone, rhythm, segment sizes, threshold style)
3. `data/canon.json` (the ONLY source for the 72 spirits' rank, legions, appearance, office, quote).
   If it does not exist yet, wait for it: `until [ -f data/canon.json ]; do sleep 20; done` (up to ~8 minutes),
   and outline meanwhile. If it never appears, verify your spirits against the 1904 Mathers/Crowley Goetia online.

You write exactly one file: `episodes/epNN.json`. Touch nothing else.

## What makes it good
- It must make a beginner lean in. Cold open on an image or a question, never on a definition. Explain every
  term the first time in half a sentence. Short spoken sentences. Dry wit. Real dread, lightly worn.
- The Keeper speaks to "you", calls episodes "nights", and occasionally refers to the listener's grimoire
  ("his seal is in your grimoire now"). She is honest: says clearly what is legend, what is documented,
  what scholars doubt. She never gives ritual instructions as instructions and never claims any of it works.
  History, folklore, literature. No moralising either.
- The `book` voice quotes the old texts (public domain). Prefer canon.json `quote` fields and real lines
  from the 1904 Goetia; you may fetch the text online (WebFetch/WebSearch via ToolSearch) to quote accurately.
  If you cannot verify a quotation word for word, have the Keeper paraphrase instead of the book quoting.
- Every spirit assigned to your night gets one `spirit: N` cue on the segment that properly introduces it
  (name, rank, legions, shape, office, said aloud, faithful to canon). Group them into a story; do not just
  list. A few may be brief (two or three sentences), but each must be vivid.
- Other spirits may be mentioned by name without a cue, but do not describe ones assigned to other nights
  in detail; tease them ("you will meet him on the fifth night").
- Use `scene`/`mood` changes 3 to 6 times where the story moves (allowed: crypt, library, court, storm, sea,
  fire, void, dawn). Set both together on the same segment.
- Exactly 2 thresholds, 3 options each, traits from scholar/seeker/skeptic/poet, replies 35 to 70 words.
  Questions should be personal and fun to answer, tied to the material ("which of these would you ask for?").
  The segment after a threshold must make sense after any reply.
- 3 to 6 glossary terms, each unlocked by a `term` on the segment that explains it.
- End by teasing the next night (title in CONTRACT.md) and a short sign-off in the Keeper's manner.
  Start with a one-line callback to the previous night where natural. Do not re-tell the Solomon/brass vessel
  story (night 1 did) beyond a passing callback.

## Length (hard)
Total words across all `t` fields plus threshold `q` fields (NOT counting replies): **{WORDS}**.
Segments 30 to 110 words each (book quotes 15 to 60). Around 28 to 40 segments.

## Speech-synthesis hygiene
Plain text only. No parentheses, brackets, slashes, ampersands, em-dash chains, or quotation marks inside
`t` (the voice cannot say them; use "he says" phrasing). Years as words ("fifteen seventy-seven").
Legion counts as words in keeper text. No "e.g.", "c.", "MS". Spell spirit names exactly as canon `name`.

## Before you finish, validate (inline python, leave no script behind)
- valid JSON; fields id/num/title/subtitle/blurb/mood/scene/segments/glossary present; id like "ep05"
- word count in range; exactly 2 thresholds with unique ids "epNN-t1"/"epNN-t2"; 3 opts each with key/label/trait/reply
- every assigned spirit number appears exactly once as a `spirit` cue, and no unassigned number appears
- every `term` exists in glossary; every mood/scene value is allowed; every `v` is keeper or book
- no forbidden characters in spoken text: ( ) [ ] / & " “ ” — and no digits in keeper text
Report: final word count, spirits covered, any facts you were unsure about, any quotation you could not verify.
