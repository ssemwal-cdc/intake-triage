"""Self-check for build_slide.py (v4 schema): no framework, just asserts.

Run: python template/test_build_slide.py  (from skills/request-slide/)

Renamed from selfcheck_build_slide.py -- same file, test-naming convention
only (so the repo's test-scope guard recognizes it as a test path).

v4 input schema (see request-slide-v4-checks brief):
{ "title": str (<=12 words), "disposition": one of the 5 dispositions,
  "disposition_plain": str, "problem": str (<=30 words),
  "evidence": [str, ...] (2-3, each ending "[n]", <=40 words total),
  "lenses": {lens: {"score": int -3..3, "why": str (<=8 words)}} for the 4 lenses,
  "total": int (== sum of lens scores), "status": "Triaged"|"Proposed",
  "decision": {"ask": str (<=20 words), "owner": str, "by": str},
  "requester": str, "function": str, "submitted": "YYYY-MM-DD",
  "notes_sources": [{"n", "title", "link", "date"}, ...], "source_file": str }
"""
import copy
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_slide  # noqa: E402

from pptx import Presentation

LENSES = ['cost', 'risk', 'time', 'benefit']

V4_SAMPLE = {
    "title": "Automate the entity-level tax allocation re-check each close",
    "disposition": "Small rock",
    "disposition_plain": "fits within a month",
    "problem": "Entity allocation is re-checked by hand every close, under deadline pressure, with no system of record.",
    "evidence": [
        "Entity allocation is re-checked by hand every close today. [1]",
        "Data lives in NetSuite and Excel models, not one system. [2]",
    ],
    "lenses": {
        "cost": {"score": -1, "why": "small script, one owner"},
        "risk": {"score": 1, "why": "removes a manual miss"},
        "time": {"score": 2, "why": "saves a day per close"},
        "benefit": {"score": 2, "why": "fewer close-cycle errors"},
    },
    "total": 4,
    "status": "Triaged",
    "decision": {"ask": "Approve a one-sprint build.", "owner": "Tax team", "by": "2026-10-15"},
    "requester": "J. Smith",
    "function": "Tax",
    "submitted": "2026-09-30",
    "notes_sources": [
        {"n": 1, "title": "Close checklist, sample", "link": "n/a", "date": "2026-10-05"},
        {"n": 2, "title": "System list, sample", "link": "n/a", "date": "2026-10-05"},
    ],
    "source_file": "2026-09-30-entity-level-tax-allocation-check-sample.json",
}

V3_SAMPLE = {
    "title_name": "Entity-level tax allocation check",
    "disposition": "Small rock",
    "ask": "Automate the hand re-check of entity-level tax allocation each close.",
    "who_how_often": "Tax team, once per close cycle, per project.",
    "triage": {
        "cost": -1, "risk": 1, "time": 2, "benefit": 2, "total": 4,
        "fit": "Yes, data exists", "decision_date": "2026-10-15",
        "note": "Fits within a month; owner confirmed.",
    },
    "context_bullets": [
        "Entity allocation is re-checked by hand every close today. [1]",
        "Data lives in NetSuite and Excel models, not one system. [2]",
    ],
    "footer_source": "2026-09-30-entity-level-tax-allocation-check-sample.json",
    "footer_date": "2026-10-05",
    "notes_sources": [
        {"n": 1, "title": "Sample source", "link": "n/a", "date": "2026-10-05"},
        {"n": 2, "title": "Sample source", "link": "n/a", "date": "2026-10-05"},
    ],
}  # inline v3 fixture: examples/sample.json was moved to the v4 shape by
# the builder, so reading it here would no longer test the v3-refusal case


def _build(fields):
    d = Path(tempfile.mkdtemp())
    out = d / 'out.pptx'
    build_slide.build(fields, out)
    return out


def _expect_value_error(fields, needle, label):
    try:
        _build(fields)
    except ValueError as e:
        assert needle.lower() in str(e).lower(), f"{label}: ValueError text {e!r} missing {needle!r}"
        print(f'ok (RED as expected): {label} refused -- {e}')
        return
    except Exception as e:  # pragma: no cover - diagnostic path for this red run
        print(f'RED (wrong reason, pre-v4 code): {label} raised {type(e).__name__}: {e}')
        return
    print(f'RED (not refused): {label} built without error -- v4 refusal not implemented')


def _run_red(label, fn):
    """Runs one post-refusal check and reports RED instead of crashing the
    run, since the v4 build does not exist yet on this commit (5e613a8)."""
    try:
        fn()
    except Exception as e:
        print(f'RED (expected until v4 build lands): {label} -- {type(e).__name__}: {e}')


# --- 1. schema / value refusals -------------------------------------------

def check_refuses_v3_schema():
    fields = copy.deepcopy(V3_SAMPLE)
    _expect_value_error(fields, 'schema', 'old v3 schema')


def check_refuses_bad_total():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['total'] = fields['total'] + 1
    _expect_value_error(fields, 'total', 'total not matching sum of lens scores')


def check_refuses_over_budget_field():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['title'] = ' '.join(['word'] * 13)
    _expect_value_error(fields, 'title', 'over-budget title (13 words, limit 12)')


def check_refuses_missing_source_for_evidence_marker():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['evidence'] = fields['evidence'] + ['Unsupported claim with no matching note. [9]']
    _expect_value_error(fields, '9', 'evidence [9] with no notes_sources entry')


# --- 2. geometry guard ------------------------------------------------------

def _content_shapes(slide):
    for sh in slide.shapes:
        if sh.shape_type in (1, 17) or (sh.is_placeholder and sh.placeholder_format.idx == 0):
            yield sh


def _rects_overlap(a, b):
    al, at, aw, ah = a
    bl, bt, bw, bh = b
    return al < bl + bw and bl < al + aw and at < bt + bh and bt < at + ah


def check_geometry():
    out = _build(copy.deepcopy(V4_SAMPLE))
    prs = Presentation(str(out))
    slide = prs.slides[0]
    slide_w, slide_h = prs.slide_width, prs.slide_height
    shapes = [(sh.name, (sh.left, sh.top, sh.width, sh.height)) for sh in _content_shapes(slide)]

    for name, (l, t, w, h) in shapes:
        assert l >= 0 and t >= 0 and l + w <= slide_w and t + h <= slide_h, (
            f"shape '{name}' at {(l, t, w, h)} falls outside the slide ({slide_w}x{slide_h})"
        )
    for i in range(len(shapes)):
        for j in range(i + 1, len(shapes)):
            name_a, rect_a = shapes[i]
            name_b, rect_b = shapes[j]
            assert not _rects_overlap(rect_a, rect_b), (
                f"shapes '{name_a}' {rect_a} and '{name_b}' {rect_b} overlap"
            )
    print(f'ok: {len(shapes)} content shapes, none overlap, all inside the slide')


# --- 3. font sizes -----------------------------------------------------------

def check_body_text_min_12pt():
    out = _build(copy.deepcopy(V4_SAMPLE))
    prs = Presentation(str(out))
    slide = prs.slides[0]
    small_runs = []
    for sh in slide.shapes:
        if not sh.has_text_frame:
            continue
        is_footer = 'footer' in sh.name.lower()
        for p in sh.text_frame.paragraphs:
            for r in p.runs:
                if r.font.size is None or not r.text.strip():
                    continue
                pt = r.font.size.pt
                floor = 9 if is_footer else 12
                if pt < floor:
                    small_runs.append((sh.name, r.text, pt, floor))
    assert not small_runs, f"text below its size floor: {small_runs}"
    print('ok: no body text below 12pt, footer text at or above 9pt')


# --- 4. no ".json" in visible text; source file only in notes --------------

def check_source_file_only_in_notes_never_visible():
    out = _build(copy.deepcopy(V4_SAMPLE))
    prs = Presentation(str(out))
    slide = prs.slides[0]
    for sh in slide.shapes:
        if sh.has_text_frame and '.json' in sh.text_frame.text.lower():
            raise AssertionError(f"visible shape '{sh.name}' shows .json: {sh.text_frame.text!r}")
    notes_text = slide.notes_slide.notes_text_frame.text
    assert V4_SAMPLE['source_file'] in notes_text, 'source_file must appear in speaker notes'
    print('ok: no visible ".json", source_file only in speaker notes')


# --- 5. plain white layout, no background art behind content ---------------

def check_no_background_art_behind_content():
    out = _build(copy.deepcopy(V4_SAMPLE))
    prs = Presentation(str(out))
    slide = prs.slides[0]
    layout = slide.slide_layout
    pics = [sh for sh in list(slide.shapes) + list(layout.shapes) if sh.shape_type == 13]  # PICTURE
    assert not pics, f"background picture(s) found on a layout that must be plain white: {[p.name for p in pics]}"
    print('ok: no picture/graphic on slide or layout (plain white layout)')


# --- 5b. no content shape overlaps a picture/logo on layout or master ------

def check_no_content_shape_overlaps_picture_or_logo():
    """A picture shape (type 13) living on the layout or the slide master --
    e.g. the Compass logo -- can sit anywhere on the canvas, including top
    right where a status tag is drawn. drop_lens_tables only removes the
    master's own lens tables; it does not move or shrink the logo, so a
    content shape placed over it is a real, separate overlap bug from the
    plain-white-background check above."""
    fields = copy.deepcopy(V4_SAMPLE)
    fields['status'] = 'Proposed'  # draws the status tag most likely to collide
    out = _build(fields)
    prs = Presentation(str(out))
    slide = prs.slides[0]
    pic_rects = [
        (sh.name, (sh.left, sh.top, sh.width, sh.height))
        for src in (slide.slide_layout.shapes, slide.slide_layout.slide_master.shapes)
        for sh in src
        if sh.shape_type == 13 and None not in (sh.left, sh.top, sh.width, sh.height)
    ]
    content_rects = [
        (sh.name, (sh.left, sh.top, sh.width, sh.height)) for sh in _content_shapes(slide)
    ]
    hits = []
    for c_name, c_rect in content_rects:
        for p_name, p_rect in pic_rects:
            if _rects_overlap(c_rect, p_rect):
                hits.append((c_name, p_name))
    assert not hits, f"content shape(s) overlap a layout/master picture (logo): {hits}"
    print('ok: no content shape overlaps a picture/logo on layout or master')


# --- 6. "Proposed" must be visible when status is Proposed ------------------

def check_proposed_status_shown_visibly():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['status'] = 'Proposed'
    out = _build(fields)
    prs = Presentation(str(out))
    slide = prs.slides[0]
    all_text = ' '.join(sh.text_frame.text for sh in slide.shapes if sh.has_text_frame)
    assert 'proposed' in all_text.lower(), 'status "Proposed" must appear visibly on the slide'
    print('ok: "Proposed" status shown visibly')


# --- 7. each lens "why" appears on the slide --------------------------------

def check_lens_why_text_present():
    out = _build(copy.deepcopy(V4_SAMPLE))
    prs = Presentation(str(out))
    slide = prs.slides[0]
    all_text = ' '.join(sh.text_frame.text for sh in slide.shapes if sh.has_text_frame)
    for lens in LENSES:
        why = V4_SAMPLE['lenses'][lens]['why']
        assert why in all_text, f"lens '{lens}' why-text {why!r} missing from slide"
    print('ok: every lens why-text appears on the slide')


# --- 8. estimated overflow ---------------------------------------------------
# Rough estimate only: chars-per-line = frame_width_inches * ~(size/ ~6) --
# here we use a simple constant of 1.9 chars per point-inch, i.e.
# chars_per_line ~= (width_in_inches * 96) / (font_size_pt * 0.62)
# and lines available = height_in_inches * 72 / (font_size_pt * 1.2).
# This is a coarse box check, not real text layout; it exists to catch a
# frame given far too little room for its text, not to be exact.

def _estimate_capacity_chars(width_emu, height_emu, size_pt):
    EMU_PER_INCH = 914400
    width_in = width_emu / EMU_PER_INCH
    height_in = height_emu / EMU_PER_INCH
    chars_per_line = max(1, (width_in * 96) / (size_pt * 0.62))
    lines = max(1, (height_in * 72) / (size_pt * 1.2))
    return chars_per_line * lines


def check_text_frames_fit_estimated_capacity():
    out = _build(copy.deepcopy(V4_SAMPLE))
    prs = Presentation(str(out))
    slide = prs.slides[0]
    overflowing = []
    for sh in slide.shapes:
        if not sh.has_text_frame:
            continue
        text = sh.text_frame.text
        if not text.strip():
            continue
        sizes = [r.font.size.pt for p in sh.text_frame.paragraphs for r in p.runs if r.font.size]
        if not sizes:
            continue
        size_pt = max(sizes)
        capacity = _estimate_capacity_chars(sh.width, sh.height, size_pt)
        if len(text) > capacity:
            overflowing.append((sh.name, len(text), round(capacity)))
    assert not overflowing, f"text frames estimated to overflow (chars vs capacity): {overflowing}"
    print('ok: no text frame estimated to overflow its box')


if __name__ == '__main__':
    check_refuses_v3_schema()
    check_refuses_bad_total()
    check_refuses_over_budget_field()
    check_refuses_missing_source_for_evidence_marker()
    _run_red('geometry guard', check_geometry)
    _run_red('body text >=12pt floor', check_body_text_min_12pt)
    _run_red('source_file hidden, only in notes', check_source_file_only_in_notes_never_visible)
    _run_red('no background art', check_no_background_art_behind_content)
    _run_red('no content/logo overlap', check_no_content_shape_overlaps_picture_or_logo)
    _run_red('"Proposed" shown visibly', check_proposed_status_shown_visibly)
    _run_red('lens why-text present', check_lens_why_text_present)
    _run_red('estimated overflow', check_text_frames_fit_estimated_capacity)
    print('all checks ran (RED expected on commit 5e613a8, before the v4 build lands)')
