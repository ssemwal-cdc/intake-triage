# Submission destination

Status: ruled 2026-09-30 by the owner: the artifact's own database (`db` capability).

- Each requester writes only their own doc `requests/<their id>` (an `items` list); they cannot read anyone else's. One doc per requester because db queries scan one collection, so Editors list everyone with one read of `requests`.
- Editors (CFO team) read every request and write triage outcomes under `triage/`.
- Rules: `requests` read and write `admin`; `requests/{self}` write `interact`; `triage` read and write `admin`.
- Superseded: the private GitHub repo `ssemwal-cdc/intake-submissions`, written through a token in the public page. It holds one TEST submission.
- Alerts: a scheduled Claude task can email a digest of new requests through the owner's M365. Not built yet.
