# Threat model

Status: ruled 2026-09-30 by the owner.

- Assume no malicious users. Do not over-engineer security.
- The one privacy goal: requesters must not readily see other people's submissions.
- Live (GitHub): submissions sit in a private repo, and requesters never get the triage link. The token in the public page can read that repo; the owner accepts this.
- Shelved (Claude artifact): claude.ai sign-in and the artifact's access rules would enforce the goal with no token.
