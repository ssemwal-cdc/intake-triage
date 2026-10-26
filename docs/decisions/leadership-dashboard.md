# Weekly leadership dashboard

Status: ruled 2026-10-26 by the owner: an org-only claude.ai artifact, not a page on the public site. Look not chosen; four mockup directions are under review.
Kind: build
Plan: docs/decisions/leadership-dashboard.md#build-plan (claude.ai artifact)

- Asked by Glen (with Jared): one page to show every week at the finance leadership meeting.
- Fields asked for: projects in flight, who each is for, status, what happened this past week, agreed completion date, forecasted completion date, and the queue.
- Why not this repo: the repo and its GitHub Pages site are public, and the page's token can read every submission. The threat model (`threat-model.md`) covers requesters seeing each other's requests, not leadership data on a public URL.
- Why an artifact: Compass claude.ai sign-in limits who can see it, with no token. This is the same reason `hosting.md` gives for the shelved claude.ai route.
- Data: the artifact keeps its own small store. The queue comes from triaged intake records (disposition big rock, small rock or backlog), copied in, not read live. Status, the weekly note, and the agreed and forecast dates exist nowhere else; the owner supplies them each week.
- Open: projects that never came through intake need a list from the owner. One view serves Glen and Jared unless they ask for two.

| Option | Gain | Loss |
|---|---|---|
| Org-only artifact (chosen) | Compass sign-in only; stable link; weekly update is one note | Queue is a copy, not live |
| Page in this repo | One home; live queue | Public URL; leadership data behind a readable token |
| Weekly slide | Fits a deck; private | Static snapshot; rebuilt weekly |
| monday.com board | Nothing to build | Intake queue does not flow in; only works if leadership uses monday |

## Build plan

1. Mockups: four directions on shared sample data, reviewed by the owner. Owner picks one.
   - Projector first: a fixed 16:9 stage scaled to fit, no scrolling, viewed like a live slide (owner, 2026-10-26).
   - Blank canvas first: builders get no palette, font or brand. The Compass brand is a later revision of the pick (owner, 2026-10-26).
   - Audience: the page is the owner reporting to leadership. No copy written at the viewer as a to-do ("Needs your attention"); use status words such as "Behind or blocked" (owner, 2026-10-26).
2. Build the picked direction as a private artifact, with its records in the artifact's store.
3. Seed it with the owner's real project list and the triaged intake queue.
4. Share it with Glen and Jared inside Compass.
5. Each week: the owner sends one line per project and any forecast changes; the store is updated, and the link stays the same.
