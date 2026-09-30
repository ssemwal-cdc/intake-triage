# Submission destination

Status: ruled 2026-09-30, GitHub repo storage (below). Table kept as the options weighed.

| Option | Gain | Loss |
|---|---|---|
| SharePoint list (via Power Automate HTTP trigger or Graph) | Lives in M365, easy to view and filter, triage can edit rows in place | Premium Power Automate connector for the HTTP trigger; list schema to maintain |
| Microsoft Forms / Lists form behind the scenes | No code for storage | Loses this page's design and validation; the page becomes a wrapper or goes away |
| Email to a shared mailbox | Simplest; nothing to host | No structured store; triage status lives in people's inboxes |
| Small API plus database (e.g. Azure Function plus table or Postgres) | Full control, clean payload, triage page reads from it | Most to build and own; needs hosting and security review |
| monday.com board (API) | Compass already uses it for tracking; triage as board columns | Another system's auth and limits; data leaves M365 |

Pick this before the submit-adapter work lands, so the adapter targets a real destination.

## Ruled 2026-09-30: GitHub repo storage

Governed by the threat-model ruling (no malicious users; submissions not readily visible).

- Public Pages repo serves `index.html`. On submit it writes one JSON file to a separate private repo (e.g. `intake-submissions`) through the GitHub contents API.
- Token: fine-grained, that one private repo only, contents read and write. Embedded in page code.
- `triage.html` on its own unlisted link reads the private repo and writes the outcome back.
- Token delivery, ruled 2026-09-30: the token is an Actions secret (`INTAKE_TOKEN`). The Pages deploy writes it into the published `assets/config.js`. The repo never holds it, so push protection never blocks it and GitHub never revokes it. No disguising.
- Both repos live under the owner's account `ssemwal-cdc`; the token is the owner's.
