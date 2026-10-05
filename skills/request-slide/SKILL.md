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
- The official Compass master, `Template_Powerpoint_Master_V2.1_03-27-25.pptx`
  ("Compass PPT Template 2.0" from Marketing). The builder reads it
  read-only, local, and never commits it. See "The master" below.

## The master

The builder opens the owner's local copy of the confidential Compass
master. It finds the master's "Business Lens - White" slide. It trims the
deck down to that one slide. It never writes to the master file. It never
commits the master, or anything built from it.

Master path, in order:

1. `--master <path>` on the command line.
2. The `INTAKE_SLIDE_MASTER` environment variable.
3. The default: the owner's OneDrive copy, at
   `C:\Users\ShivamSemwal\OneDrive - Compass Datacenters, LLC\Downloads 16 Pro\Template_Powerpoint_Master_V2.1_03-27-25.pptx`.

`.gitignore` blocks any `*master*.pptx` or `Template_Powerpoint_Master*.pptx`
under `skills/request-slide/`. The master itself, and any slide built from
it, can never land in this repo. Only `examples/sample.json` is committed
(the fields, not a slide). A sample render goes to a scratch folder, never
to `examples/`.

## Template

`template/build_slide.py` is the only thing that writes the .pptx. It opens
the master read-only. It keeps only the master's "Business Lens - White"
slide. White is the master's own rule for an internal, detail-heavy deck.
It drops the other 139 slides from the output.

It reuses that slide's own title, footer ("Confidential and Proprietary"),
tagline, and logo, exactly as the layout provides them. It reuses the
slide's four Cost/Risk/Time/Benefit tables as the score tiles, resized into
one row. A fifth tile, for Total, is cloned from the same table shape. The
master has no Total tile of its own.

Colors, where the master leaves the choice: onyx (#141E27), slate
(#34444D), orange (#F37820), and #B3530C for small orange text. Arial
throughout.

Section order: title (name and disposition), the ask, who and how often,
triage (the five tiles, then fit, decision date, and note), context
(numbered bullets), and a footer note. The footer note gives the source
file name and date. It sits beside the master's own "Confidential and
Proprietary" line.

Speaker notes list each numbered source, with title, link, and date. They
mark unverified claims. See `examples/sample.json` for a worked example
(sample data only, no live SharePoint or Teams content). Build it yourself
to see the rendered slide. The output itself is never committed.
