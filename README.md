# Request intake / triage

Plain static site for the request intake form and its internal triage view.
No framework, no build step, no dependencies.

## Layout

- `index.html` — the whole page: requester form, triage view, and the view toggle between them.
- `assets/styles.css` — page styles.
- `assets/app.js` — page behaviour (view toggle, validation, triage-record fill-in).
- `assets/compass-logo.png` — header logo.
- `docs/source/request-intake-mockup.html` — the original single-file mockup, kept for reference.

## Preview locally

Open `index.html` directly in a browser, or serve the folder:

```
python -m http.server 8000
```

then visit http://localhost:8000

Submitting the form is preview only: nothing is sent anywhere.
