---
name: request-slide
description: Use when the user asks to "make the management slide for <submission>", wants a "one-slider for request ...", or says "request slide". Builds a one-slide management summary (.pptx) for one intake-triage submission, from the submission's own fields plus a small, scoped SharePoint and Teams context search.
---

# request-slide

Builds one fixed-template management slide for one request in
`ssemwal-cdc/intake-submissions`. Every slide uses the same layout. Only the
text changes. Governing ruling: `docs/decisions/request-slide.md` in
`intake_triage`.

## Steps

1. **Get the submission file name** from the user. It looks like
   `2026-09-30-test-end-to-end-check-4li3ye.json`, or a full path like
   `submissions/2026-09-30-test-end-to-end-check-4li3ye.json`.

2. **Read the submission:**
   ```
   gh api repos/ssemwal-cdc/intake-submissions/contents/submissions/<name> -H "Accept: application/vnd.github.raw"
   ```
   Parse the JSON. If `triage` is `null`, stop and ask the owner. There is
   no disposition yet to put on a management slide.

3. **Build context searches**, from the request's own terms (shortName,
   function, whatGoesWrong, envisionedSolution). Skip generic words.
   - Up to 3 SharePoint searches: Microsoft 365 connector `sharepoint_search`,
     then read the top hit or hits with `read_resource`.
   - Up to 3 Teams searches: `chat_message_search`. If the submission's
     `sensitiveData` is `"Yes"`, skip Teams search entirely.
   - Keep only hits tied to this request: the same project, system, or
     person named in the submission. Drop everything else.

4. **Show the owner the kept and dropped sources.** One line per source:
   title, and why it was kept or dropped. Wait for a yes before building
   anything.

5. **Fill the fixed template.** Build a fields JSON (see schema below) from
   the submission, the triage object, and the approved sources. Shorten any
   text yourself to fit the word budgets below. Never rely on the script to
   auto-shrink text. It fails loudly on overflow instead.

   Fields JSON schema (all required):
   ```json
   {
     "title_name": "short name",
     "disposition": "Big rock | Small rock | Backlog | Redirect | Decline",
     "ask": "<= 30 words",
     "who_how_often": "<= 20 words",
     "triage": {
       "cost": -3..3, "risk": -3..3, "time": -3..3, "benefit": -3..3,
       "total": number, "fit": "short phrase", "decision_date": "YYYY-MM-DD",
       "note": "short phrase (triage section as a whole is <= 30 words)"
     },
     "context_bullets": ["2 or 3 bullets, <= 40 words total, each ending in [n]"],
     "footer_source": "the submission file name",
     "footer_date": "today, YYYY-MM-DD",
     "notes_sources": [
       {"n": 1, "title": "...", "link": "...", "date": "...", "unverified": false}
     ]
   }
   ```
   Mark an unverified claim as `"unverified": true` on its source entry.
   That renders in the speaker notes.

6. **Run the builder:**
   ```
   python skills/request-slide/template/build_slide.py fields.json <out.pptx>
   ```
   Save to the folder the owner names. The default is
   `~/Documents/intake-slides/<file-stem>.pptx`. The file-stem is the
   submission file name, without `.json`.

7. **Upload nothing.** The slide stays local.

## Requirements

- `python-pptx`. Install with `pip install python-pptx`.
- `gh` CLI, authenticated for `ssemwal-cdc/intake-submissions`.
- The Microsoft 365 connector (`sharepoint_search`, `chat_message_search`,
  `read_resource`), for context searches.

## Template

`template/build_slide.py` is the only thing that writes the .pptx. It is
fixed: 16:9, white background, onyx (#141E27) title band, orange (#F37820)
accent rule, #B3530C small orange headings, slate (#34444D) body text, and
Arial throughout. The Compass logo (`assets/compass-logo.png`) sits top
right. Section order: title (name and disposition), the ask, who and how
often, triage, context (numbered bullets), and footer (source file name and
date). Speaker notes list each numbered source with title, link, and date.
They mark unverified claims. See `examples/sample.json` and
`examples/sample.pptx` for a worked example. That example uses sample data
only, with no live SharePoint or Teams content.
