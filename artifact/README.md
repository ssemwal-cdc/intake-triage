# Claude artifact: intake-artifact.html

One self-contained page, form and triage, for publishing as a Claude artifact
(claude.ai) per `docs/decisions/hosting.md` (route B). Reuses the copy,
validation, layout and behaviour of `index.html`/`assets/app.js` and
`triage.html`/`assets/triage.js` word for word.

## Declared capabilities

Set these when publishing, in the Artifact tool's `capabilities` parameter:

```json
{
  "db": {
    "rules": [
      { "path": "", "read": "view", "write": "admin" },
      { "path": "requests", "read": "admin", "write": "admin" },
      { "path": "requests/{self}", "read": "interact", "write": "interact" },
      { "path": "triage", "read": "admin", "write": "admin" }
    ]
  },
  "user": {}
}
```

## Storage shape (deviation from the brief, documented)

The brief's suggested path was `requests/<uid>/items/<itemId>` (4 segments,
one document per submission). `db.d.ts`'s `Query`/`CollectionReference`
only scans the ONE collection path named. There is no collection-group or
recursive query across every requester's `items` subcollection. An Editor
would need every requester's uid in advance to enumerate them, which
defeats "list all requests across requesters."

The nearest legal shape under `requests/{self}` that keeps enumeration
possible: each requester gets exactly **one** document, `requests/<uid>`
(2 segments, matching the `requests/{self}` write rule exactly). That
document holds an `items` array of that requester's submissions, each item
carrying its own `id`. Editors enumerate everyone with a single
`db.collection("requests").onSnapshot(...)` call, allowed by the
`read: "admin"` rule on `requests`.

Triage stays exactly as ruled: `triage/<requesterId>__<itemId>`, a flat
admin-only collection (`db.collection("triage")` enumerable the same way).
Status tags on the picker read live from this collection.

## Known ceiling (ponytail)

Adding an item reads the requester's document, then replaces it whole with
`get()` then `set()`. The reason: `update()` replaces array fields wholesale
rather than merging them, so it cannot append to `items` on its own. Two
submits from the same signed-in requester inside one short window could
race. One could overwrite the other's `items` array. The threat model rules
out malicious users and says not to over-engineer
(`docs/decisions/threat-model.md`), so this ceiling stands. Upgrade path if
it matters: an `items` subcollection per requester document instead of an
array field, once volume or the race rate justifies it.

## Never stored

Only the requester's opaque `user.id()` is used, as the `requests/<uid>`
document id, never their name, email or avatar from the `user` capability.
`yourName` in the payload is the plain text the requester typed into the
form field, not anything read from their Claude profile.

## Check

`artifact/test-harness.mjs` (Playwright, run the same way as
`scripts/e2e.test.mjs`, from outside the repo's own dependency tree). It serves
`intake-artifact.html` wrapped in a minimal document skeleton. It injects a
fake `window.claude.use`. That fake implements the `db`/`user` subset the
page calls, and it enforces the rules above. A requester's fake db reads
and writes only its own `requests/<uid>` subtree. An editor's fake db can
read everything.
