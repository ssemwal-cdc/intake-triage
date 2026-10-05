# request-slide

Builds one fixed-template management slide (.pptx) for one intake-triage
request. See `SKILL.md` for the full steps, and
`docs/decisions/request-slide.md` in `intake_triage` for the ruling.

## Install

Copy this whole folder to `~/.claude/skills/request-slide/`:

```
cp -r skills/request-slide ~/.claude/skills/request-slide
```

## Requirements

- `python-pptx`. Install with `pip install python-pptx`.
- `gh` CLI, authenticated for `ssemwal-cdc/intake-submissions`.
- The Microsoft 365 connector, for SharePoint and Teams context searches.

## Org rule

A deck going outside Compass, to any external audience, must go to
Marketing first. That applies to any slide this skill builds.
