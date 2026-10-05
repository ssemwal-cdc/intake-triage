# Submission destination

Status: ruled 2026-09-30 by the owner. Live: the private GitHub repo `ssemwal-cdc/intake-submissions`, one JSON file per request under `submissions/`, triage outcome inside the same file.

- The public page writes through a fine-grained token (that repo only, Contents read and write), injected at deploy from the Actions secret `INTAKE_TOKEN`. The repo never holds the token.
- Shelved: the Claude artifact's own database (route B, see hosting). Rules kept for a restart: `requests` read and write `admin`; `requests/{self}` read and write `interact`; `triage` read and write `admin`; one doc per requester with an `items` list.
- Not built: email alerts on new requests.
