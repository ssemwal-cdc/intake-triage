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
  "notes_sources": [{"n", "title", "link", "date"}, ...], "source_file": str,
  "culture": [str, ...] (the submission's cultureFactors, <=12 words total, may be empty) }
"""
import copy
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_slide  # noqa: E402

from pptx import Presentation
from pptx.util import Emu

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
    "culture": ["Poka Yoke", "Power of Incremental"],
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


# decision.owner, decision.by, requester, function feed fixed-height boxes
# (the decision band, the footer row) with no word budget enforced today --
# an overflow bypass the reviewer found. Budgets: owner 6, by 4, requester 5,
# function 5 words.

def check_refuses_over_budget_decision_owner():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['decision']['owner'] = ' '.join(['Owner'] * 7)
    _expect_value_error(fields, 'owner', 'over-budget decision.owner (7 words, budget 6)')


def check_refuses_over_budget_decision_by():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['decision']['by'] = ' '.join(['By'] * 5)
    _expect_value_error(fields, 'by', 'over-budget decision.by (5 words, budget 4)')


def check_refuses_over_budget_requester():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['requester'] = ' '.join(['Requester'] * 6)
    _expect_value_error(fields, 'requester', 'over-budget requester (6 words, budget 5)')


def check_refuses_over_budget_function():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['function'] = ' '.join(['Function'] * 6)
    _expect_value_error(fields, 'function', 'over-budget function (6 words, budget 5)')


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


# --- 5. no picture inside the content area; a full-slide background art ----
# still fails. The content area is the band below the title rule and above
# the footer row -- the Compass logo and any other small corner picture are
# allowed to live outside that band (title row, or below the footer row).

PICTURE = 13


def _all_pictures(slide):
    layout = slide.slide_layout
    for src in (slide.shapes, layout.shapes, layout.slide_master.shapes):
        for sh in src:
            if sh.shape_type == PICTURE and None not in (sh.left, sh.top, sh.width, sh.height):
                yield sh


def _content_area_bounds(fields):
    """Same geometry the build itself uses: title bottom to the layout's
    own footer row. Recomputed from the master directly (not from build's
    internals) so this stays a check on the built output, not a mirror of
    the implementation."""
    master_path = build_slide.resolve_master_path(None)
    prs = Presentation(master_path)
    idx = build_slide.find_business_lens_slide(prs)
    slide = prs.slides[idx]
    title_ph = next(sh for sh in slide.placeholders if sh.placeholder_format.idx == 0)
    content_top = title_ph.top + title_ph.height
    layout_footer = next(
        (sh for sh in slide.slide_layout.shapes if 'footer' in sh.name.lower() and sh.has_text_frame), None
    )
    content_bottom = layout_footer.top if layout_footer is not None else prs.slide_height - Emu(400000)
    return content_top, content_bottom


def check_no_picture_inside_content_area():
    out = _build(copy.deepcopy(V4_SAMPLE))
    prs = Presentation(str(out))
    slide = prs.slides[0]
    content_top, content_bottom = _content_area_bounds(V4_SAMPLE)
    bad = []
    for sh in _all_pictures(slide):
        if sh.top < content_bottom and sh.top + sh.height > content_top:
            bad.append((sh.name, sh.top, sh.height))
    assert not bad, (
        f"picture(s) fall inside the content area (below the title, above the footer): {bad}"
    )
    print('ok: no picture (background art or otherwise) inside the content area')


# --- 5b. the Compass logo must be present on the slide, and visible --------

LOGO_MAX_AREA_FRACTION = 0.05  # a logo is a small corner picture, not the
# full-slide background swoosh, which covers most of the slide area


def check_logo_present_and_visible():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['status'] = 'Proposed'  # draws the status tag most likely to cover it
    out = _build(fields)
    prs = Presentation(str(out))
    slide = prs.slides[0]
    slide_area = prs.slide_width * prs.slide_height
    logos = [
        sh for sh in _all_pictures(slide)
        if (sh.width * sh.height) / slide_area < LOGO_MAX_AREA_FRACTION
    ]
    assert logos, 'the Compass logo picture must be present on the slide, layout or master'
    logo = logos[0]
    logo_rect = (logo.left, logo.top, logo.width, logo.height)
    content_rects = [(sh.name, (sh.left, sh.top, sh.width, sh.height)) for sh in _content_shapes(slide)]
    coverers = [name for name, rect in content_rects if _rects_overlap(rect, logo_rect)]
    assert not coverers, f"logo {logo.name!r} is covered by content shape(s): {coverers}"
    print('ok: Compass logo present and not covered by any content shape')


# --- 5c. decision band sits close above the footer row, no empty gap ------

FOOTER_GAP_MAX_IN = 0.6
EMU_PER_INCH = 914400


def _decision_band(slide):
    """The decision band is the only full-width (left==0, width==slide_w)
    autoshape rectangle this script draws."""
    slide_w = slide.part.package.presentation_part.presentation.slide_width
    for sh in slide.shapes:
        if sh.shape_type == 1 and sh.left == 0 and sh.width == slide_w:
            return sh
    return None


def check_decision_band_close_to_footer():
    out = _build(copy.deepcopy(V4_SAMPLE))
    prs = Presentation(str(out))
    slide = prs.slides[0]
    band = _decision_band(slide)
    assert band is not None, 'no full-width decision band shape found'
    _, footer_top = _content_area_bounds(V4_SAMPLE)
    band_bottom = band.top + band.height
    gap_in = (footer_top - band_bottom) / EMU_PER_INCH
    assert 0 <= gap_in <= FOOTER_GAP_MAX_IN, (
        f"decision band bottom is {gap_in:.2f}in above the footer row, budget is {FOOTER_GAP_MAX_IN}in"
    )
    print(f'ok: decision band sits {gap_in:.2f}in above the footer row')


# --- 5d. within each column, consecutive content shapes stay close --------
# (no single gap swallows all the column's leftover space). Columns: left is
# x < 55% of slide width, right is the rest. Scoped to the shapes between
# the PROPOSED tag and the decision band; the gap above the tag and below
# the band is exempt.

COLUMN_SPLIT_FRACTION = 0.55
MAX_INTRA_COLUMN_GAP_IN = 0.5


def check_column_shapes_stay_close():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['status'] = 'Proposed'
    out = _build(fields)
    prs = Presentation(str(out))
    slide = prs.slides[0]
    slide_w = prs.slide_width

    tag = next(sh for sh in slide.shapes if sh.has_text_frame and 'proposed' in sh.text_frame.text.lower())
    band = _decision_band(slide)
    assert band is not None, 'no full-width decision band shape found'

    between = [
        sh for sh in _content_shapes(slide)
        if sh is not tag and sh is not band
        and sh.top >= tag.top + tag.height and sh.top < band.top
    ]
    split_x = slide_w * COLUMN_SPLIT_FRACTION
    columns = {
        'left': sorted((sh for sh in between if sh.left < split_x), key=lambda sh: sh.top),
        'right': sorted((sh for sh in between if sh.left >= split_x), key=lambda sh: sh.top),
    }
    bad = []
    for col_name, shapes in columns.items():
        for prev, nxt in zip(shapes, shapes[1:]):
            gap_in = (nxt.top - (prev.top + prev.height)) / EMU_PER_INCH
            if gap_in > MAX_INTRA_COLUMN_GAP_IN:
                bad.append((col_name, prev.name, nxt.name, round(gap_in, 2)))
    assert not bad, (
        f"gap(s) over {MAX_INTRA_COLUMN_GAP_IN}in between consecutive shapes in a column: {bad}"
    )
    print('ok: no column has a gap over 0.5in between consecutive shapes')


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


# --- 7b. culture line: shown when the submission ticks culture factors ----

def _slide_text(fields):
    slide = Presentation(str(_build(fields))).slides[0]
    return ' '.join(sh.text_frame.text for sh in slide.shapes if sh.has_text_frame)


def check_culture_line_shown():
    text = _slide_text(copy.deepcopy(V4_SAMPLE))
    assert 'Culture:' in text, 'no "Culture:" line on the slide'
    for item in V4_SAMPLE['culture']:
        assert item in text, f"culture item {item!r} missing from slide"
    print('ok: culture line shows every culture item')


def check_no_culture_line_when_empty():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['culture'] = []
    assert 'Culture:' not in _slide_text(fields), 'empty culture must draw no "Culture:" line'
    print('ok: no culture line when culture is empty')


def check_refuses_over_budget_culture():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['culture'] = ['Lowest Total Cost of Ownership', 'Failure on the Path to Success', 'Built to Last']
    _expect_value_error(fields, 'culture', 'over-budget culture (14 words, budget 12)')


def check_refuses_bad_culture_shape():
    for bad, label in (("Poka Yoke", 'a string'), (['', ' '], 'blank items'), (None, 'None'), ([1, 2], 'non-strings')):
        fields = copy.deepcopy(V4_SAMPLE)
        fields['culture'] = bad
        _expect_value_error(fields, 'culture', f'culture as {label}')


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


# --- 8b. boundary-length owner/by/requester/function still fit -------------
# Once check_budgets refuses over-budget values, the budgets themselves
# (6/4/5/5 words) must still leave the decision band and footer box -- both
# fixed-size boxes -- fitting their text at the boundary, under the same
# chars-per-line x lines estimate used above.

def check_boundary_fields_still_fit_band_and_footer():
    fields = copy.deepcopy(V4_SAMPLE)
    fields['decision']['owner'] = ' '.join(['Owner'] * 6)
    fields['decision']['by'] = ' '.join(['By'] * 4)
    fields['requester'] = ' '.join(['Requester'] * 5)
    fields['function'] = ' '.join(['Function'] * 5)
    out = _build(fields)
    prs = Presentation(str(out))
    slide = prs.slides[0]
    band = _decision_band(slide)
    assert band is not None, 'no full-width decision band shape found'
    footer = next(sh for sh in slide.shapes if sh.name == 'Footer note')
    overflowing = []
    for sh, label in ((band, 'decision band'), (footer, 'footer box')):
        text = sh.text_frame.text
        sizes = [r.font.size.pt for p in sh.text_frame.paragraphs for r in p.runs if r.font.size]
        size_pt = max(sizes) if sizes else 12
        capacity = _estimate_capacity_chars(sh.width, sh.height, size_pt)
        if len(text) > capacity:
            overflowing.append((label, len(text), round(capacity)))
    assert not overflowing, (
        f"band/footer text estimated to overflow at the owner/by/requester/function budget boundary: {overflowing}"
    )
    print('ok: decision band and footer box still fit at the field-length boundary')


if __name__ == '__main__':
    check_refuses_v3_schema()
    check_refuses_bad_total()
    check_refuses_over_budget_field()
    check_refuses_missing_source_for_evidence_marker()
    check_refuses_over_budget_decision_owner()
    check_refuses_over_budget_decision_by()
    check_refuses_over_budget_requester()
    check_refuses_over_budget_function()
    check_refuses_over_budget_culture()
    check_refuses_bad_culture_shape()
    _run_red('geometry guard', check_geometry)
    _run_red('body text >=12pt floor', check_body_text_min_12pt)
    _run_red('source_file hidden, only in notes', check_source_file_only_in_notes_never_visible)
    _run_red('no picture inside content area', check_no_picture_inside_content_area)
    _run_red('logo present and visible', check_logo_present_and_visible)
    _run_red('decision band close to footer', check_decision_band_close_to_footer)
    _run_red('column shapes stay close', check_column_shapes_stay_close)
    _run_red('"Proposed" shown visibly', check_proposed_status_shown_visibly)
    _run_red('lens why-text present', check_lens_why_text_present)
    _run_red('culture line shown', check_culture_line_shown)
    _run_red('no culture line when empty', check_no_culture_line_when_empty)
    _run_red('estimated overflow', check_text_frames_fit_estimated_capacity)
    _run_red('boundary fields fit band/footer', check_boundary_fields_still_fit_band_and_footer)
    print('all checks ran (RED expected on commit 5e613a8, before the v4 build lands)')
