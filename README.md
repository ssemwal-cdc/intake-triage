# Request intake / triage

Plain static site for the request intake form and its internal triage view.
No framework, no build step, no dependencies in the site itself.

## Layout

- `index.html` — the requester form only. No link or reference to triage.
- `triage.html` — the internal triage view, on its own unlisted page.
- `assets/styles.css` — shared page styles for both pages.
- `assets/config.js` — `window.INTAKE_CONFIG` (owner, repo, branch, token). Committed with an
  empty token; the deploy workflow fills it in at build time. Never commit a real token.
- `assets/submit.js` — `submitRequest(payload)`, loaded by `index.html` only. Empty token: logs
  the payload to the console and resolves. This is the local preview path. Token set: PUTs the
  payload as a JSON file to the submissions repo, using the GitHub contents API.
- `assets/app.js` — the requester form's behaviour: validation, payload build, submit handling.
- `assets/triage.js` — the triage view's behaviour: a Requests table (filter, search, sort),
  open a row, save outcome. The row's status and scores update in place after a save, no
  reload. With no token, it shows a sample record and "Preview only."
- `assets/compass-logo.png` — header logo.
- `assets/icon-32.png`, `assets/icon-180.png` — browser-tab icons, copied from `q_max`'s `public/`.
- `docs/source/request-intake-mockup.html` — the original single-file mockup, kept for reference.

FORM_TITLE (in `assets/app.js`) is the single place to rename the form.

## Preview locally

Serve the folder. `fetch` and the config script need an http(s) origin.

```
python -m http.server 8000
```

Then visit http://localhost:8000. With no token in `assets/config.js`, submitting the form logs
the payload to the console and shows the confirmation. `triage.html` shows a sample record.

## Setup for real submissions (GitHub repo storage)

1. Create a **private** GitHub repo to hold submissions. For example, `ssemwal-cdc/intake-submissions`.
2. Create a **fine-grained personal access token** scoped to that one repo only. Give it the
   repository permission **Contents: Read and write**.
3. Save the token as an **Actions secret** named `INTAKE_TOKEN` on this site's repo. It lives
   under Settings, then Secrets and variables, then Actions.
4. Set `owner`, `repo` and `branch` in `assets/config.js` to match the submissions repo. Leave
   `token: ''`. The deploy workflow (`.github/workflows/pages.yml`) writes the real token into
   the build output only. It never touches the committed source.
5. In this repo's Settings, then Pages, set **Source: GitHub Actions**.

On push to `main`, or on a manual run, the workflow writes `INTAKE_TOKEN` into `assets/config.js`
in the deployed copy. It then publishes with `actions/configure-pages`, `upload-pages-artifact`
and `deploy-pages`.

## Payload shape

Pretty-printed JSON, with 2-space indent. Keys follow the form's order. Values hold the words
the requester saw, for example the gap tile's title, not its internal code. An empty optional
answer is `""` or `[]`. `triage` starts `null`. It fills in later, in place, from `triage.html`.

```json
{
  "yourName": "Jordan Lee",
  "function": "Tax",
  "shortName": "Vendor on-time tracker",
  "owner": "Jordan Lee",
  "whatGoesWrong": "We re-check vendor terms by hand every month.",
  "envisionedSolution": "",
  "cultureFactors": ["Built to Last", "Poka Yoke"],
  "frequency": "Monthly",
  "effort": "",
  "users": "",
  "informationLivesIn": ["NetSuite", "Excel models"],
  "closestGap": "We take it on trust",
  "sensitiveData": "No",
  "systemConnection": "Yes",
  "systemAccess": "Read only",
  "submittedAt": "2026-09-30T14:05:00.000Z",
  "formTitle": "Shivam's PO Box",
  "schemaVersion": 1,
  "triage": null
}
```

The submissions repo file name is `submissions/{YYYY-MM-DD}-{slug of short name}-{6 random
chars}.json`. For example, `submissions/2026-09-30-vendor-on-time-tracker-a1b2c3.json`.

Once triaged, `triage` on the same file becomes an object. For example:

```json
{
  "changesRecurringDecision": "Yes",
  "dataExists": "Partly",
  "ownerConfirmed": "Yes",
  "lenses": { "Cost": 1, "Risk": -1, "Time": 2, "Benefit": 3 },
  "disposition": "Small rock",
  "decisionDate": "2026-10-03",
  "redirectTo": "",
  "note": "Approved for next sprint.",
  "savedAt": "2026-10-03T09:00:00.000Z"
}
```

## Check that proves it works

`scripts/e2e.test.mjs` is a Playwright script. It stays outside the site's own dependency tree. Run
it from any folder with Playwright installed. For example:

```
mkdir -p /tmp/intake-e2e && cd /tmp/intake-e2e
npm init -y >/dev/null && npm i -D playwright >/dev/null && npx playwright install chromium
node /path/to/intake_triage/scripts/e2e.test.mjs
```

It starts `python -m http.server` on a free port other than 8000. It intercepts `api.github.com`
with an in-memory fake repo, through `page.route`. It drives Chromium at 1280px and 375px widths.

Coverage:

- Every button and control's behaviour, and the Other-source follow-up.
- The required errors and the Other-empty error.
- A successful submit. The decoded JSON is checked against the expected object, including the
  🤨 emoji.
- A failed submit. Answers stay in the form and the error shows.
- The Requests table: status/function/search filters, combined, and sort per column type.
  The "N of M requests" count and both empty states. Row open by click and by Enter. The
  save round-trip, updating the row in place.
- The empty-token preview path.
- The absence of "triage" in `index.html`.
- The mouse-vs-keyboard focus ring.

It prints a pass/fail summary and stops only the server it started.
