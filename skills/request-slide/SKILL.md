---
name: request-slide
description: Use when the user asks to "make the management slide for <submission>", wants a "one-slider for request ...", or says "request slide". Builds a one-slide management summary (.pptx) for one intake-triage submission. The slide argues for a decision; it never just reprints the intake form.
---

# request-slide

Builds one fixed-template management slide for one request in
`ssemwal-cdc/intake-submissions`. Every slide uses the same layout. Only the
text changes. Governing ruling: `docs/decisions/request-slide.md` in
`intake_triage`.

The slide argues for a decision, not the form. Write the title as a
recommendation sentence. Give each lens a one-line reason. Pull and cite
real evidence. Never invent a fact or a figure the submission does not
give you.

## Steps

1. **Get the submission file name** from the user. It looks like
   `2026-09-30-test-end-to-end-check-4li3ye.json`, or a full path like
   `submissions/2026-09-30-test-end-to-end-check-4li3ye.json`.

2. **Read the submission:**
   ```
   gh api repos/ssemwal-cdc/intake-submissions/contents/submissions/<name> -H "Accept: application/vnd.github.raw"
   ```
   Parse the JSON. If `triage` is `null`, continue with `status` set to
   `"Proposed"` (see step 5).

3. **Search the owner's connectors for context**, with the Microsoft 365
   connector. Use the request's own terms (shortName, function,
   whatGoesWrong, envisionedSolution, the systems it names). Skip generic
   words.
   - Teams, up to 4 searches with `chat_message_search`:
     - the request's key terms;
     - the same terms with `sender` set to the requester (`yourName`);
     - the same terms with `sender` set to the named owner;
     - "ASK FIRST" plus the key terms.
     Read each promising hit in full with `read_resource`. Posts by the
     requester about the same work are the strongest source.
   - SharePoint, up to 3 searches with `sharepoint_search`. Include any file
     that a kept Teams post attaches. Read the top hits with `read_resource`.
   - Outlook, up to 2 searches with `outlook_email_search`, for the
     request's key terms and the requester as sender.
   - If the submission's `sensitiveData` is `"Yes"`, skip the Teams and
     Outlook searches. Search SharePoint only.
   - Keep only hits tied to this request: the same project, system, or
     person named in the submission. Drop everything else. Never quote
     message text beyond what one evidence bullet needs.

4. **Show the owner the kept and dropped sources.** One line per source:
   title, and why it was kept or dropped. Wait for a yes before building
   anything.

5. **Fill the fixed template.** Build a fields JSON (see schema below) from
   the submission, the triage object, and the approved sources. Shorten any
   text yourself to fit the word budgets below. Never rely on the script to
   auto-shrink text. It fails loudly on overflow instead.

   - Write `title` as a recommendation sentence (what to do, and why),
     never the bare submission name. If `status` is `Proposed`, phrase it
     as the proposed action.
   - Write `problem` from the submission's own `whatGoesWrong` words, kept
     in the requester's own voice. Never invent a dollar or hour figure
     the submission does not give you.
   - Write each `lenses.<name>.why` as the one-line reason behind that
     score, grounded in the evidence or the submission.
   - Pull `evidence` from the kept SharePoint/Teams sources (step 3-4), not
     from the submission text. Every bullet ends in a `[n]` that has a
     matching entry in `notes_sources`.
   - If `triage` on the submission is empty, set `status` to `"Proposed"`.
     Propose your own `lenses` scores and `disposition`, grounded in the
     evidence. Say in the handoff that these are proposed, not triaged.
   - Pair `disposition` with `disposition_plain`: the plain-English meaning
     of that disposition (for example "Small rock" -> "Fits within a
     month"). Never show the disposition alone.

   Fields JSON schema (all required):
   ```json
   {
     "title": "recommendation sentence, <= 12 words",
     "disposition": "Big rock | Small rock | Backlog | Redirect | Decline",
     "disposition_plain": "plain meaning of the disposition",
     "problem": "<= 30 words",
     "evidence": ["2 or 3 bullets, <= 40 words total, each ending in [n]"],
     "lenses": {
       "cost": {"score": -3..3, "why": "<= 8 words"},
       "risk": {"score": -3..3, "why": "<= 8 words"},
       "time": {"score": -3..3, "why": "<= 8 words"},
       "benefit": {"score": -3..3, "why": "<= 8 words"}
     },
     "total": "sum of the four lens scores",
     "status": "Triaged | Proposed",
     "decision": {
       "ask": "<= 20 words, what the owner must decide",
       "owner": "who decides",
       "by": "YYYY-MM-DD or TBD"
     },
     "requester": "from the submission",
     "function": "from the submission",
     "submitted": "the submission's own submitted date, YYYY-MM-DD",
     "notes_sources": [
       {"n": 1, "title": "...", "link": "...", "date": "..."}
     ],
     "source_file": "the submission file name"
   }
   ```

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
- The Microsoft 365 connector (`chat_message_search`, `sharepoint_search`,
  `outlook_email_search`, `read_resource`), for context searches.
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

It reuses that slide's own footer ("Confidential and Proprietary") and
logo, exactly as the layout provides them. It drops the slide's own four
Cost/Risk/Time/Benefit tables; a compact scorecard is drawn fresh instead,
one row per lens plus a Total row. Every text box is drawn with an opaque
white fill, so the master's own background graphic never shows through
and crosses the text.

Colors, where the master leaves the choice: onyx (#141E27), slate
(#34444D), orange (#F37820), and #B3530C for small orange text. Arial
throughout.

Layout, top to bottom:
- Title: the recommendation sentence. A "PROPOSED" tag shows next to it
  when `status` is `Proposed`.
- Left column: the problem, then its evidence.
- Right column: the scorecard, the Total row, then the disposition paired
  with its plain meaning.
- Bottom band: the decision needed, its owner, and its due date, on an
  onyx strip.
- Footer note, beside the master's own "Confidential and Proprietary"
  line: the requester, function, and submission date.

Speaker notes list the source file, then each numbered source with its
title, link, and date. See `examples/sample.json` for a worked example
(sample data only, no live SharePoint or Teams content). Build it yourself
to see the rendered slide. The output itself is never committed.
