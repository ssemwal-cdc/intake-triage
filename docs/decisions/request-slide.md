# One-slide management summary of a request

Status: ruled 2026-10-05 by the owner: build the skill and the button. Skill and button built (8928ee9); template rebuilt on the official master (373e491, 5e613a8); v4 rebuild (owner's v3 review) in progress on `slide-v4`.

- Build as a Claude skill `request-slide`, not in triage.html. A static page has no Microsoft sign-in for SharePoint or Teams and no safe place for a model key.
- Input: a submission file name. The skill reads it from `intake-submissions` with `gh`, and stops if triage is empty.
- Context: at most 3 SharePoint and 3 Teams searches built from the request's own terms. Keep only hits tied to the request. Skip Teams chat search when `sensitiveData` is "Yes". Show the owner the source list before building.
- Slide, about 120 words: title (short name and disposition); the ask; who and how often; triage scores and note; 2 to 3 context bullets with numbered source markers, sources in speaker notes.
- Output: a .pptx in a local folder the owner names. Nothing is uploaded.
- triage.html gets one "Copy slide prompt" button that copies the request's file name in a ready prompt.
- The skill ships one fixed slide template, so every slide looks the same: Compass design language (onyx #141E27, slate #34444D, orange #F37820, #B3530C for small orange text, Arial, the Compass logo from assets/compass-logo.png). The template's layout and type sizes never vary per request; only the text fills change.
- Ruled 2026-10-05: build each slide inside the official Compass master `Template_Powerpoint_Master_V2.1_03-27-25.pptx` (Marketing, "Compass PPT Template 2.0"), white content layout (master rule: white for internal or detail-heavy decks), its footer "Confidential and Proprietary", and its Business Lens slide for the four scores.
- Colours: the owner's brief (onyx #141E27, slate #34444D, orange #F37820, #B3530C small orange text), not the 2024 guideline values.
- The master is confidential and this repo is public: never commit it. The skill reads it from a local path (default the owner's OneDrive copy), configurable in the skill.
- Ruled 2026-10-06 (owner's v3 review): a management slide must argue for a decision, never reprint the intake form. v4 schema: `title` is a recommendation sentence. The five score tiles shrink to a compact scorecard, one lens per row, each with a one-line reason. The problem and its evidence, not the triage fields, are the main content. A disposition always pairs with its plain meaning; it never stands alone. The master's background swoosh picture is dropped outright (by width, keeping the logo), so it never crosses text. A bottom onyx band states the decision needed, its owner, and its due date.
