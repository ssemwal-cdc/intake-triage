#!/usr/bin/env python3
"""Fixed-template management slide builder.

Builds one slide inside the official Compass master
(Template_Powerpoint_Master_V2.1_03-27-25.pptx): its "Business Lens - White"
slide, trimmed to the single slide, with the title and the Cost/Risk/Time/
Benefit tables reused as-is (resized into a score row) and a matching Total
tile added. Ask / who / context are added as plain text boxes. The master's
own footer, tagline and logo come from its layout; this script never draws
its own band or logo.

Usage: python build_slide.py <fields.json> <out.pptx> [--master <path>]

The master path, in order: --master flag, INTAKE_SLIDE_MASTER env var, then
the owner's OneDrive copy (default below). It is opened read-only; nothing
is ever written back to it, and it must never be committed to this repo
(see .gitignore).

Word budgets are enforced here (not left to the caller) so a slide can never
ship with overflow text silently truncated by auto-shrink: this script fails
loudly instead. The skill must shorten text itself before calling this.
"""
import argparse
import copy
import json
import os
import sys
from pathlib import Path

from pptx import Presentation
from pptx.util import Pt, Emu
from pptx.dml.color import RGBColor
from pptx.shapes.graphfrm import GraphicFrame

ONYX = RGBColor(0x14, 0x1E, 0x27)
SLATE = RGBColor(0x34, 0x44, 0x4D)
ORANGE = RGBColor(0xF3, 0x78, 0x20)
ORANGE_SMALL = RGBColor(0xB3, 0x53, 0x0C)
FONT = 'Arial'

DEFAULT_MASTER = (
    r"C:\Users\ShivamSemwal\OneDrive - Compass Datacenters, LLC"
    r"\Downloads 16 Pro\Template_Powerpoint_Master_V2.1_03-27-25.pptx"
)

LENS_ORDER = ['Cost', 'Risk', 'Time', 'Benefit']


def word_count(text):
    return len(text.split())


def triage_word_count(t):
    parts = [
        f"Cost {t['cost']}", f"Risk {t['risk']}", f"Time {t['time']}",
        f"Benefit {t['benefit']}", f"Total {t['total']}", t['fit'],
        t['decision_date'], t.get('note', ''),
    ]
    return word_count(' '.join(str(p) for p in parts if p))


def check_budgets(f):
    errors = []
    if word_count(f['ask']) > 30:
        errors.append(f"'ask' is {word_count(f['ask'])} words, budget is 30")
    if word_count(f['who_how_often']) > 20:
        errors.append(f"'who_how_often' is {word_count(f['who_how_often'])} words, budget is 20")
    tw = triage_word_count(f['triage'])
    if tw > 30:
        errors.append(f"'triage' section is {tw} words, budget is 30")
    bullets = f['context_bullets']
    if not (2 <= len(bullets) <= 3):
        errors.append(f"'context_bullets' has {len(bullets)} items, must be 2 or 3")
    total_bullet_words = sum(word_count(b) for b in bullets)
    if total_bullet_words > 40:
        errors.append(f"'context_bullets' total is {total_bullet_words} words, budget is 40")
    for i, b in enumerate(bullets):
        if not b.rstrip().endswith(']') or '[' not in b:
            errors.append(f"context_bullets[{i}] must end with a numbered source marker like '[1]'")
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


def set_run_text(cell, row_idx, text, size_pt=None, bold=None):
    """Replace a table cell's text, keeping its first run's formatting
    (font, color) so it still matches the template's look."""
    tf = cell.text_frame
    p = tf.paragraphs[0]
    if not p.runs:
        p.add_run()
    run = p.runs[0]
    run.text = text
    for extra in p.runs[1:]:
        extra.text = ''
    for extra_p in tf.paragraphs[1:]:
        for r in extra_p.runs:
            r.text = ''
    if size_pt is not None:
        run.font.size = Pt(size_pt)
    if bold is not None:
        run.font.bold = bold
    return run


def rescale_table(gframe, left, top, width, height, col_fractions):
    """Resize a cloned/reused table's columns and rows to fit a new frame.
    A table's rendered size is the sum of its own column widths and row
    heights, not the graphic frame's xfrm, so both must be set. Columns use
    explicit fractions (not the original proportions): the original middle
    column was sized for a paragraph of body text that no longer lives
    there, and scaling it down verbatim leaves too little width for the
    one-word header label, wrapping it letter by letter."""
    table = gframe.table
    acc = 0
    n = len(table.columns)
    for i, col in enumerate(table.columns):
        new_w = width - acc if i == n - 1 else round(width * col_fractions[i])
        col.width = Emu(new_w)
        acc += new_w
    # row split: a short header line, a tall score line, a thin spacer
    row_fractions = [0.22, 0.56, 0.22]
    acc = 0
    for i, row in enumerate(table.rows):
        new_h = height - acc if i == len(table.rows) - 1 else round(height * row_fractions[i])
        row.height = Emu(new_h)
        acc += new_h
    gframe.left, gframe.top, gframe.width, gframe.height = Emu(left), Emu(top), Emu(width), Emu(height)


def clone_lens_tile(slide, source_gframe):
    """Deep-copy a lens table's shape for the Total tile, stripped of its
    placeholder binding (two shapes cannot share one layout placeholder)."""
    new_el = copy.deepcopy(source_gframe._element)
    ph = new_el.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}ph')
    if ph is not None:
        ph.getparent().remove(ph)
    slide.shapes._spTree.append(new_el)
    return GraphicFrame(new_el, slide.shapes)


def add_textbox(slide, left, top, width, height, text, size, color, bold=False, italic=False):
    box = slide.shapes.add_textbox(Emu(left), Emu(top), Emu(width), Emu(height))
    tf = box.text_frame
    tf.word_wrap = True
    run = tf.paragraphs[0].add_run()
    run.text = text
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.font.bold = bold
    run.font.italic = italic
    return box


def build(fields, out_path, master_path=None):
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

    # title placeholder, reused as-is (idx 0 on this layout)
    title_ph = next(sh for sh in slide.placeholders if sh.placeholder_format.idx == 0)
    tf = title_ph.text_frame
    tf.clear()
    run = tf.paragraphs[0].add_run()
    run.text = f"{fields['title_name']} \u2014 {fields['disposition']}"
    run.font.name = FONT

    lens_tables = {}
    for sh in list(slide.shapes):
        if sh.has_table:
            header = sh.table.cell(0, 0).text.strip()
            if header in LENS_ORDER:
                lens_tables[header] = sh

    missing = [k for k in LENS_ORDER if k not in lens_tables]
    if missing:
        raise RuntimeError(f"Business Lens slide is missing table(s) for {missing}")

    # lay out a row of 5 tiles (Cost, Risk, Time, Benefit, Total) below "who"
    margin = title_ph.left
    gap = Emu(150000)
    tile_w = (slide_w - 2 * margin - 4 * gap) // 5
    tile_h = Emu(1150000)
    tiles_top = Emu(3250000)
    # label | spacer | legend; label gets enough width that one word (e.g.
    # "Benefit") never wraps letter by letter
    COL_FRACTIONS = [0.42, 0.40, 0.18]

    def clear_lens_body(table):
        """Clear every 'Lorem ipsum' / 'More ipsum' placeholder cell. The
        '-- / ++' scale legend in column 2 is a fixed template element, not
        data, and is left as the master ships it."""
        for cell in (table.cell(1, 1), table.cell(2, 0), table.cell(2, 1)):
            set_run_text(cell, 0, '', size_pt=8)

    t = fields['triage']
    scores = {'Cost': t['cost'], 'Risk': t['risk'], 'Time': t['time'], 'Benefit': t['benefit']}

    x = margin
    for name in LENS_ORDER:
        gframe = lens_tables[name]
        table = gframe.table
        score = scores[name]
        set_run_text(table.cell(0, 0), 0, name, size_pt=10, bold=True)
        set_run_text(table.cell(1, 0), 1, f"{score:+d}" if score else '0', size_pt=16, bold=True)
        clear_lens_body(table)
        rescale_table(gframe, x, tiles_top, tile_w, tile_h, COL_FRACTIONS)
        x += tile_w + gap

    total_gframe = clone_lens_tile(slide, lens_tables['Cost'])
    total_table = total_gframe.table
    set_run_text(total_table.cell(0, 0), 0, 'Total', size_pt=10, bold=True)
    set_run_text(total_table.cell(0, 2), 0, '', size_pt=8)  # Total has no -- / ++ scale
    set_run_text(total_table.cell(1, 0), 1, f"{t['total']:+d}" if t['total'] else '0', size_pt=16, bold=True)
    set_run_text(total_table.cell(1, 2), 1, '', size_pt=8)
    set_run_text(total_table.cell(2, 2), 2, '', size_pt=8)
    clear_lens_body(total_table)
    rescale_table(total_gframe, x, tiles_top, tile_w, tile_h, COL_FRACTIONS)

    def heading(text, top):
        return add_textbox(slide, margin, top, Emu(6500000), Emu(270000), text, 12, ORANGE_SMALL, bold=True)

    def body(text, top, height=900000, width=None):
        return add_textbox(slide, margin, top, Emu(width or slide_w - 2 * margin), Emu(height), text, 14, SLATE)

    ask_top = 950000
    heading('THE ASK', ask_top)
    body(fields['ask'], ask_top + 280000, height=620000)

    who_top = ask_top + 1000000
    heading('WHO AND HOW OFTEN', who_top)
    body(fields['who_how_often'], who_top + 280000, height=400000)

    heading('TRIAGE', tiles_top - 350000)
    caption_top = tiles_top + int(tile_h) + 250000
    caption = f"Fit: {t['fit']}  |  Decision date: {t['decision_date']}"
    body(caption, caption_top, height=250000)
    if t.get('note'):
        body(t['note'], caption_top + 260000, height=350000)

    context_top = caption_top + 700000
    heading('CONTEXT', context_top)
    bullets_box = slide.shapes.add_textbox(Emu(margin), Emu(context_top + 280000), Emu(slide_w - 2 * margin), Emu(900000))
    btf = bullets_box.text_frame
    btf.word_wrap = True
    for i, b in enumerate(fields['context_bullets']):
        p = btf.paragraphs[0] if i == 0 else btf.add_paragraph()
        run = p.add_run()
        run.text = '\u2022 ' + b
        run.font.name = FONT
        run.font.size = Pt(13)
        run.font.color.rgb = SLATE

    # footer note: beside the layout's own "Confidential and Proprietary"
    # footer shape, same row, never overlapping it. On this master that
    # shape is named "Footer Placeholder" but is not an actual <p:ph>
    # placeholder, so it must be found via .shapes, not .placeholders.
    layout_footer = next(
        (sh for sh in slide.slide_layout.shapes if 'footer' in sh.name.lower() and sh.has_text_frame), None
    )
    if layout_footer is not None:
        footer_left = layout_footer.left + layout_footer.width + Emu(300000)
        footer_top = layout_footer.top
        footer_height = layout_footer.height
    else:
        footer_left, footer_top, footer_height = margin, slide_h - Emu(400000), Emu(300000)
    footer = f"Source: {fields['footer_source']}    {fields['footer_date']}"
    add_textbox(slide, footer_left, footer_top, slide_w - margin - footer_left, footer_height, footer, 10, SLATE, italic=True)

    # speaker notes: sources with title, link, date; unverified claims marked
    notes = slide.notes_slide
    lines = []
    for s in fields.get('notes_sources', []):
        tag = ' (unverified)' if s.get('unverified') else ''
        lines.append(f"[{s['n']}] {s['title']} \u2014 {s.get('link', '')} \u2014 {s.get('date', '')}{tag}")
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
