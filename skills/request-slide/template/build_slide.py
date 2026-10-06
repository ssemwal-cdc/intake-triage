#!/usr/bin/env python3
"""Fixed-template management slide builder (v4).

Builds one slide inside the official Compass master
(Template_Powerpoint_Master_V2.1_03-27-25.pptx): its "Business Lens - White"
slide, trimmed to the single slide. The master's own Cost/Risk/Time/Benefit
tables are dropped; a compact scorecard is drawn instead. The slide argues
for a decision: a recommendation-sentence title, the problem and its
evidence as the main content, a compact scorecard (not five big tiles), and
a bottom decision band. The master's own footer, tagline and logo come from
its layout; this script never draws its own band or logo for those.

Usage: python build_slide.py <fields.json> <out.pptx> [--master <path>]

The master path, in order: --master flag, INTAKE_SLIDE_MASTER env var, then
the owner's OneDrive copy (default below). It is opened read-only; nothing
is ever written back to it, and it must never be committed to this repo
(see .gitignore).

Word budgets and schema shape are enforced here (not left to the caller) so
a slide can never ship with overflow text silently truncated by
auto-shrink, or with stale (v3) fields that silently build a wrong slide:
this script fails loudly instead. The skill must shorten text itself before
calling this.
"""
import argparse
import json
import os
import re
from pathlib import Path

from pptx import Presentation
from pptx.util import Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

ONYX = RGBColor(0x14, 0x1E, 0x27)
SLATE = RGBColor(0x34, 0x44, 0x4D)
ORANGE = RGBColor(0xF3, 0x78, 0x20)
ORANGE_SMALL = RGBColor(0xB3, 0x53, 0x0C)
ROW_BG = RGBColor(0xF3, 0xF4, 0xF5)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = 'Arial'

DEFAULT_MASTER = (
    r"C:\Users\ShivamSemwal\OneDrive - Compass Datacenters, LLC"
    r"\Downloads 16 Pro\Template_Powerpoint_Master_V2.1_03-27-25.pptx"
)

LENS_ORDER = ['cost', 'risk', 'time', 'benefit']
LENS_LABEL = {'cost': 'Cost', 'risk': 'Risk', 'time': 'Time', 'benefit': 'Benefit'}
DISPOSITIONS = {'Big rock', 'Small rock', 'Backlog', 'Redirect', 'Decline'}
STATUSES = {'Triaged', 'Proposed'}

REQUIRED_KEYS = {
    'title', 'disposition', 'disposition_plain', 'problem', 'evidence',
    'lenses', 'total', 'status', 'decision', 'requester', 'function',
    'submitted', 'notes_sources', 'source_file',
}
# v3 schema keys: if any of these show up, the caller is passing the old
# intake-form-shaped fields, not the v4 decision-argument schema.
V3_KEYS = {
    'title_name', 'ask', 'who_how_often', 'triage', 'context_bullets',
    'footer_source', 'footer_date',
}

GAP = 180000


def word_count(text):
    return len(text.split())


def check_schema(f):
    errors = []
    present_v3 = V3_KEYS & set(f)
    if present_v3:
        errors.append(
            "fields use the old (v3) schema: " + ', '.join(sorted(present_v3))
            + ". Rebuild the fields JSON against the v4 schema (see SKILL.md)."
        )
    missing = REQUIRED_KEYS - set(f)
    if missing:
        errors.append(f"missing required field(s): {', '.join(sorted(missing))}")
    if errors:
        raise ValueError('Fields do not match the v4 schema:\n' + '\n'.join(' - ' + e for e in errors))


def check_budgets(f):
    errors = []
    if word_count(f['title']) > 12:
        errors.append(f"'title' is {word_count(f['title'])} words, budget is 12")
    if f['disposition'] not in DISPOSITIONS:
        errors.append(f"'disposition' is {f['disposition']!r}, must be one of {sorted(DISPOSITIONS)}")
    if f['status'] not in STATUSES:
        errors.append(f"'status' is {f['status']!r}, must be one of {sorted(STATUSES)}")
    if word_count(f['problem']) > 30:
        errors.append(f"'problem' is {word_count(f['problem'])} words, budget is 30")

    evidence = f['evidence']
    if not (2 <= len(evidence) <= 3):
        errors.append(f"'evidence' has {len(evidence)} items, must be 2 or 3")
    total_evidence_words = sum(word_count(b) for b in evidence)
    if total_evidence_words > 40:
        errors.append(f"'evidence' total is {total_evidence_words} words, budget is 40")
    source_ns = {s['n'] for s in f.get('notes_sources', [])}
    for i, b in enumerate(evidence):
        m = re.search(r'\[(\d+)\]\s*$', b.rstrip())
        if not m:
            errors.append(f"evidence[{i}] must end with a numbered source marker like '[1]'")
        elif int(m.group(1)) not in source_ns:
            errors.append(f"evidence[{i}] cites [{m.group(1)}], but notes_sources has no entry with n={m.group(1)}")

    lenses = f['lenses']
    missing_lenses = set(LENS_ORDER) - set(lenses)
    if missing_lenses:
        errors.append(f"'lenses' is missing: {', '.join(sorted(missing_lenses))}")
    else:
        for name in LENS_ORDER:
            why = lenses[name]['why']
            if word_count(why) > 8:
                errors.append(f"lenses.{name}.why is {word_count(why)} words, budget is 8")
        score_sum = sum(lenses[name]['score'] for name in LENS_ORDER)
        if score_sum != f['total']:
            errors.append(f"'total' is {f['total']}, but the lens scores sum to {score_sum}")

    if word_count(f['decision']['ask']) > 20:
        errors.append(f"'decision.ask' is {word_count(f['decision']['ask'])} words, budget is 20")

    if errors:
        raise ValueError('Slide text over budget, shorten before building:\n' + '\n'.join(' - ' + e for e in errors))


def resolve_master_path(master_arg):
    return master_arg or os.environ.get('INTAKE_SLIDE_MASTER') or DEFAULT_MASTER


def find_business_lens_slide(prs):
    """Index of the master's 'Business Lens ... White' slide."""
    for i, s in enumerate(prs.slides):
        name = s.slide_layout.name.lower()
        if 'business lens' in name and 'white' in name:
            return i
    raise RuntimeError("No 'Business Lens ... White' slide found in the master")


def keep_only_slide(prs, keep_index):
    """Drop every slide but one, so the saved file carries a single slide
    (python-pptx only serializes parts still reachable from a relationship,
    so the other 139 template slides are not carried in the output)."""
    xml_slides = prs.slides._sldIdLst
    for i, sld in enumerate(list(xml_slides)):
        if i == keep_index:
            continue
        prs.part.drop_rel(sld.rId)
        xml_slides.remove(sld)


def drop_lens_tables(slide):
    """Remove the master's own Cost/Risk/Time/Benefit tables. They carry
    "-- / ++" scale markers and blank body cells sized for a full-page
    Business Lens slide; a compact scorecard is built fresh instead."""
    for sh in list(slide.shapes):
        if sh.has_table:
            sh._element.getparent().remove(sh._element)


def drop_layout_table_placeholders(slide):
    """Remove the layout's own 'Table Placeholder' prompt boxes. Dropping
    the slide's table shapes (drop_lens_tables) does not remove these: an
    empty placeholder still inherits its box/border from the layout and
    renders as a faint ghost rectangle wherever this script's own content
    does not fully cover it. This edits only the in-memory layout copy of
    this trimmed output deck, never the master file on disk."""
    layout = slide.slide_layout
    for sh in list(layout.shapes):
        if 'table placeholder' in sh.name.lower():
            sh._element.getparent().remove(sh._element)


SWOOSH_MIN_WIDTH = 6000000  # EMU: the master's background swoosh is ~9.5M wide; the logo is ~0.3M


def drop_swoosh_pictures(slide):
    """Remove only the background swoosh picture(s), keeping the logo.
    The master's 'white' layouts all carry a large decorative picture
    that runs under most of the slide; it has no swoosh-free variant.
    Rather than paint over it with opaque text boxes (a patch that still
    left grey slivers showing in any gap), this drops the swoosh picture
    outright, so the slide is genuinely plain white -- but the layout's
    small logo picture is a different, much narrower shape, and stays.
    This edits only the in-memory copy of this trimmed output deck,
    never the master on disk."""
    PICTURE = 13
    for sh in list(slide.shapes) + list(slide.slide_layout.shapes):
        if sh.shape_type == PICTURE and sh.width is not None and sh.width >= SWOOSH_MIN_WIDTH:
            sh._element.getparent().remove(sh._element)


def find_logo(slide):
    """The layout's small logo picture, if any (used to keep content clear of it)."""
    PICTURE = 13
    for sh in slide.slide_layout.shapes:
        if sh.shape_type == PICTURE and sh.width is not None and sh.width < SWOOSH_MIN_WIDTH:
            return sh
    return None


def clear_logo_of_content_area(slide, content_top):
    """Nudge the logo fully above the content area (title row only) if it
    dips below content_top. The master places it a little below the
    title's own top, straddling where this script's content starts; no
    content shape is ever drawn there, so moving the logo up is the only
    fix, and it only touches this trimmed output's in-memory layout."""
    logo = find_logo(slide)
    if logo is not None and logo.top + logo.height > content_top:
        logo.top = Emu(max(0, content_top - logo.height))


def set_text(tf, runs, size, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.MIDDLE, word_wrap=True):
    """runs: list of (text, color, bold) tuples placed on one paragraph."""
    tf.clear()
    tf.word_wrap = word_wrap
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    for text, color, bold in runs:
        run = p.add_run()
        run.text = text
        run.font.name = FONT
        run.font.size = Pt(size)
        run.font.color.rgb = color
        run.font.bold = bold


def add_textbox(slide, left, top, width, height, size=14, anchor=MSO_ANCHOR.TOP, name=None):
    """A plain text box, no fill. drop_swoosh_pictures() removes the
    master's background picture outright (see there), so a text box needs
    no white patch of its own to stay legible."""
    box = slide.shapes.add_textbox(Emu(left), Emu(top), Emu(width), Emu(height))
    box.shadow.inherit = False
    box.text_frame.vertical_anchor = anchor
    if name:
        box.name = name
    return box


def add_rect(slide, left, top, width, height, fill_color):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Emu(left), Emu(top), Emu(width), Emu(height))
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill_color
    shp.line.fill.background()
    shp.shadow.inherit = False
    return shp


def heading(slide, left, top, width, text):
    box = add_textbox(slide, left, top, width, 230000)
    set_text(box.text_frame, [(text, ORANGE_SMALL, True)], 12)
    return 230000


def build(fields, out_path, master_path=None):
    check_schema(fields)
    check_budgets(fields)
    master_path = resolve_master_path(master_path)
    if not Path(master_path).exists():
        raise FileNotFoundError(
            f"Master template not found at {master_path}. Pass --master, or set INTAKE_SLIDE_MASTER."
        )

    prs = Presentation(master_path)  # read-only: build() never writes back to master_path
    keep_idx = find_business_lens_slide(prs)
    keep_only_slide(prs, keep_idx)
    slide = prs.slides[0]
    slide_w, slide_h = prs.slide_width, prs.slide_height

    # --- Title: the recommendation sentence, reusing the layout placeholder ---
    title_ph = next(sh for sh in slide.placeholders if sh.placeholder_format.idx == 0)
    # Read the full inherited geometry up front: this placeholder has no
    # xfrm of its own (it inherits from the layout), and python-pptx fills
    # in only the attribute you set if you assign a single one (left/top/
    # width/height) without the others, zeroing the rest. Always set all
    # four together below.
    title_left, title_top, title_width, title_height = (
        title_ph.left, title_ph.top, title_ph.width, title_ph.height
    )
    margin = title_left
    content_w = slide_w - 2 * margin
    title_ph.left, title_ph.top, title_ph.width, title_ph.height = (
        title_left, title_top, title_width, title_height
    )

    tf = title_ph.text_frame
    tf.clear()
    run = tf.paragraphs[0].add_run()
    run.text = fields['title']
    run.font.name = FONT

    drop_lens_tables(slide)
    drop_layout_table_placeholders(slide)
    drop_swoosh_pictures(slide)  # background art only; the layout's logo stays
    clear_logo_of_content_area(slide, title_top + title_height)

    body_top = title_top + title_height + GAP
    if fields['status'] == 'Proposed':
        # A small tag under the title, never in the top-right corner where
        # the (now-dropped) logo used to sit.
        tag_w, tag_h = 1500000, 260000
        tag = add_rect(slide, margin, body_top, tag_w, tag_h, ORANGE)
        set_text(tag.text_frame, [('PROPOSED', WHITE, True)], 12, align=PP_ALIGN.CENTER)
        body_top += tag_h + GAP

    # --- Footer row, fixed at the bottom, beside the master's own footer ---
    layout_footer = next(
        (sh for sh in slide.slide_layout.shapes if 'footer' in sh.name.lower() and sh.has_text_frame), None
    )
    if layout_footer is not None:
        footer_left = layout_footer.left + layout_footer.width + Emu(300000)
        footer_top = layout_footer.top
        footer_height = min(layout_footer.height, slide_h - footer_top)
    else:
        footer_left, footer_top, footer_height = margin, slide_h - Emu(400000), Emu(300000)

    col_gap = 250000
    left_w = round((content_w - col_gap) * 0.6)
    right_w = content_w - col_gap - left_w
    left_x = margin
    right_x = margin + left_w + col_gap

    EMU_PER_INCH = 914400

    def est_h(text, width_emu, size_pt, pad=60000):
        """A text box tall enough for `text` at `size_pt` in `width_emu`,
        using the same chars-per-line/line-height model as the estimated-
        overflow check, plus a small pad so wrapped text never bleeds past
        its box into whatever is drawn next."""
        width_in = width_emu / EMU_PER_INCH
        chars_per_line = max(1, (width_in * 96) / (size_pt * 0.62))
        lines = max(1, -(-len(text) // int(chars_per_line)))
        line_h = (size_pt * 1.2 / 72) * EMU_PER_INCH
        return round(lines * line_h) + pad

    # --- Decision band: pinned just above the footer row, same spot on
    # every slide (template consistency). The two columns below then
    # spread their own content over the space between the title/tag and
    # the band, each with even internal gaps, instead of a fixed small
    # gap followed by one large empty area. ---
    band_h = 500000
    band_top = footer_top - GAP - band_h
    available_h = band_top - GAP - body_top

    # Left column: the problem, then its evidence. Natural (tight) heights
    # first; the one gap between the two blocks then absorbs whatever
    # space is left, so the column's content reaches the band exactly.
    heading_h, heading_gap = 230000, 60000
    problem_h = est_h(fields['problem'], left_w, 16)
    evidence_h = sum(est_h(b, left_w, 13) for b in fields['evidence'])
    left_fixed = 2 * (heading_h + heading_gap) + problem_h + evidence_h
    left_gap = max(GAP, available_h - left_fixed)

    cursor = body_top
    cursor += heading(slide, left_x, cursor, left_w, 'THE PROBLEM') + heading_gap
    problem_box = add_textbox(slide, left_x, cursor, left_w, problem_h)
    set_text(problem_box.text_frame, [(fields['problem'], SLATE, False)], 16, anchor=MSO_ANCHOR.TOP)
    cursor += problem_h + left_gap

    cursor += heading(slide, left_x, cursor, left_w, 'EVIDENCE') + heading_gap
    evidence_box = add_textbox(slide, left_x, cursor, left_w, evidence_h)
    etf = evidence_box.text_frame
    etf.clear()
    etf.word_wrap = True
    for i, b in enumerate(fields['evidence']):
        p = etf.paragraphs[0] if i == 0 else etf.add_paragraph()
        p.space_after = Pt(6)
        run = p.add_run()
        run.text = '\u2022 ' + b
        run.font.name = FONT
        run.font.size = Pt(13)
        run.font.color.rgb = SLATE

    # Right column: compact scorecard (4 lens rows, then Total, then the
    # disposition paired with its plain meaning so neither stands alone).
    # Row height is fixed (the same on every slide); the 5 gaps between
    # the 6 rows absorb whatever space is left, same as the left column.
    row_h = 460000
    name_w = round(right_w * 0.32)
    score_w = round(right_w * 0.18)
    reason_w = right_w - name_w - score_w
    lenses = fields['lenses']
    disp_text = f"{fields['disposition']} \u2014 {fields['disposition_plain']}"
    disp_h = est_h(disp_text, right_w, 12)
    right_fixed = 5 * row_h + disp_h
    row_gap = max(60000, round((available_h - right_fixed) / 5))

    y = body_top
    for name in LENS_ORDER:
        score = lenses[name]['score']
        name_rect = add_rect(slide, right_x, y, name_w, row_h, ROW_BG)
        set_text(name_rect.text_frame, [(LENS_LABEL[name], ONYX, True)], 12, align=PP_ALIGN.LEFT)
        score_rect = add_rect(slide, right_x + name_w, y, score_w, row_h, ROW_BG)
        set_text(score_rect.text_frame, [(f"{score:+d}", ONYX, True)], 14, align=PP_ALIGN.CENTER)
        reason_rect = add_rect(slide, right_x + name_w + score_w, y, reason_w, row_h, ROW_BG)
        set_text(reason_rect.text_frame, [(lenses[name]['why'], SLATE, False)], 12, align=PP_ALIGN.LEFT)
        y += row_h + row_gap

    total_name = add_rect(slide, right_x, y, name_w + score_w, row_h, ORANGE)
    set_text(total_name.text_frame, [('TOTAL', WHITE, True)], 12, align=PP_ALIGN.LEFT)
    total_score = add_rect(slide, right_x + name_w + score_w, y, reason_w, row_h, ORANGE)
    set_text(total_score.text_frame, [(f"{fields['total']:+d}", WHITE, True)], 14, align=PP_ALIGN.CENTER)
    y += row_h + row_gap

    disp_box = add_textbox(slide, right_x, y, right_w, disp_h)
    set_text(disp_box.text_frame, [(disp_text, ONYX, False)], 12, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP)

    band = add_rect(slide, 0, band_top, slide_w, band_h, ONYX)
    decision = fields['decision']
    band_text = f"Decision needed: {decision['ask']} \u00b7 Owner: {decision['owner']} \u00b7 By: {decision['by']}"
    band.text_frame.margin_left = Emu(int(margin) - 91440)  # align with the body's left margin, net of the rect's own text inset
    set_text(band.text_frame, [(band_text, WHITE, True)], 13, align=PP_ALIGN.LEFT)

    # --- Footer note, beside the master's own footer row ---
    footer_width = slide_w - margin - footer_left
    footer_text = f"{fields['requester']}, {fields['function']} \u00b7 submitted {fields['submitted']}"
    footer_box = add_textbox(slide, footer_left, footer_top, footer_width, footer_height, name='Footer note')
    set_text(footer_box.text_frame, [(footer_text, SLATE, False)], 9, align=PP_ALIGN.LEFT)

    # --- Speaker notes: sources with title, link, date, plus the source file ---
    notes = slide.notes_slide
    lines = [f"Source file: {fields['source_file']}"]
    for s in fields.get('notes_sources', []):
        lines.append(f"[{s['n']}] {s['title']} \u2014 {s.get('link', '')} \u2014 {s.get('date', '')}")
    notes.notes_text_frame.text = '\n'.join(lines)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out_path))
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('fields_json')
    ap.add_argument('out_pptx')
    ap.add_argument('--master', default=None, help='Path to the Compass master .pptx (read-only)')
    args = ap.parse_args()
    fields = json.loads(Path(args.fields_json).read_text(encoding='utf-8'))
    build(fields, args.out_pptx, master_path=args.master)


if __name__ == '__main__':
    main()
