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
- A local copy of the official Compass master,
  `Template_Powerpoint_Master_V2.1_03-27-25.pptx`. The builder reads it
  read-only. It defaults to the owner's OneDrive copy. Point it elsewhere
  with `--master <path>` or the `INTAKE_SLIDE_MASTER` environment variable.

## The master is never committed

The master is confidential. This repo is public. `.gitignore` blocks any
`*master*.pptx` file under `skills/request-slide/`, so neither the master
nor a full slide deck built from it can land here. Only
`examples/sample.json` is committed; it holds fields, not slide content.

## Checks

Run the slide checks before any slide PR merges. CI does not run them,
because the master is confidential. From `skills/request-slide/`, with
`INTAKE_SLIDE_MASTER` set if the master is not at its default path:

```
python template/test_build_slide.py
```

It prints PASS or FAIL, and exits 1 on any failure.

## Org rule

A deck going outside Compass, to any external audience, must go to
Marketing first. That applies to any slide this skill builds.
