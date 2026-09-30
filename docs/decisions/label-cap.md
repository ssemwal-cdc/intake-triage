# Label word cap on form pages

Status: ruled 2026-09-30 by the owner.

- `index.html` and `triage.html` are exempt from lint rule STE020 (4-word cap on labels), through a file-level `ste-disable-file` note.
- Why: form questions are full sentences. A real `<label>` lets a click on the question focus its field.
