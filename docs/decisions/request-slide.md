# One-slide management summary of a request

Status: proposed 2026-10-05; waits on the owner's word.

- Build as a Claude skill `request-slide`, not in triage.html. A static page has no Microsoft sign-in for SharePoint or Teams and no safe place for a model key.
- Input: a submission file name. The skill reads it from `intake-submissions` with `gh`, and stops if triage is empty.
- Context: at most 3 SharePoint and 3 Teams searches built from the request's own terms. Keep only hits tied to the request. Skip Teams chat search when `sensitiveData` is "Yes". Show the owner the source list before building.
- Slide, about 120 words: title (short name and disposition); the ask; who and how often; triage scores and note; 2 to 3 context bullets with numbered source markers, sources in speaker notes.
- Output: a .pptx in a local folder the owner names. Nothing is uploaded.
- triage.html gets one "Copy slide prompt" button that copies the request's file name in a ready prompt.
