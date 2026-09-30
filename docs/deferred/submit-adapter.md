# Submit through an adapter

Status: deferred (first pass keeps the mockup's preview handler).

- Replace the preview submit handler with `submitRequest(payload)` that returns a promise.
- One implementation for now: a local preview adapter that logs the payload and shows the confirmation.
- Document the payload JSON shape in the README.
