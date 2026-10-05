#!/usr/bin/env python3
"""Fixed-template management slide builder.

Builds one slide inside the official Compass master
(Template_Powerpoint_Master_V2.1_03-27-25.pptx): its "Business Lens - White"
slide, trimmed to the single slide, title reused as-is. The master's own
Cost/Risk/Time/Benefit tables are dropped (they carry "-- / ++" scale
markers and empty cells meant for a full-page Business Lens slide, not a
compact score row); five plain score tiles are drawn instead, in the
brief's own colors. Ask / who / triage / context are plain text boxes. The
master's own footer, tagline and logo come from its layout; this script
never draws its own band or logo.

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
import json
import os
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
TILE_BODY_BG = RGBColor(0xF3, 0xF4, 0xF5)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = 'Arial'

DEFAULT_MASTER = (
    r"C:\Users\ShivamSemwal\OneDrive - Compass Datacenters, LLC"
    r"\Downloads 16 Pro\Template_Powerpoint_Master_V2.1_03-27-25.pptx"
)

LENS_ORDER = ['Cost', 'Risk', 'Time', 'Benefit']

# Consistent vertical rhythm: every section (Ask, Who, Triage, Context)
# starts GAP after the previous one ends, so spacing reads as one system
# and there is no large empty band.
GAP = 220000


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


def drop_lens_tables(slide):
    """Remove the master's own Cost/Risk/Time/Benefit tables. They carry
    "-- / ++" scale markers and blank body cells sized for a full-page
    Business Lens slide; a compact score row is built fresh instead."""
    for sh in list(slide.shapes):
        if sh.has_table:
            sh._element.getparent().remove(sh._element)


def set_text(tf, text, size, color, bold=True, align=PP_ALIGN.CENTER):
    tf.clear()
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.font.bold = bold


def add_tile(slide, left, top, width, height, label, score_text, header_color):
    """One score tile: a colored header band (label, white bold) over a
    light body band (the big score, in onyx). No empty cells, no scale
    markers — just the two pieces of data a reader needs."""
    header_h = round(height * 0.38)
    body_h = height - header_h

    header = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Emu(left), Emu(top), Emu(width), Emu(header_h))
    header.fill.solid()
    header.fill.fore_color.rgb = header_color
    header.line.fill.background()
    header.shadow.inherit = False
    set_text(header.text_frame, label, 11, WHITE)

    body = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Emu(left), Emu(top + header_h), Emu(width), Emu(body_h))
    body.fill.solid()
    body.fill.fore_color.rgb = TILE_BODY_BG
    body.line.fill.background()
    body.shadow.inherit = False
    set_text(body.text_frame, score_text, 22, ONYX)

    return header, body


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

    drop_lens_tables(slide)

    margin = title_ph.left
    content_w = slide_w - 2 * margin
    t = fields['triage']
    scores = {'Cost': t['cost'], 'Risk': t['risk'], 'Time': t['time'], 'Benefit': t['benefit']}

    def heading(text, top):
        box = add_textbox(slide, margin, top, content_w, 260000, text, 12, ORANGE_SMALL, bold=True)
        return 260000

    def body(text, top, height):
        add_textbox(slide, margin, top, content_w, height, text, 14, SLATE)
        return height

    cursor = title_ph.top + title_ph.height + GAP

    # --- Ask ---
    cursor += heading('THE ASK', cursor) + 60000
    cursor += body(fields['ask'], cursor, 560000) + GAP

    # --- Who and how often ---
    cursor += heading('WHO AND HOW OFTEN', cursor) + 60000
    cursor += body(fields['who_how_often'], cursor, 400000) + GAP

    # --- Triage: five tiles, then fit / decision date / note below them,
    # in their own block with clear spacing (never on top of the tiles) ---
    cursor += heading('TRIAGE', cursor) + 60000
    tile_gap = 150000
    tile_w = (content_w - 4 * tile_gap) // 5
    tile_h = 1050000
    x = margin
    for name in LENS_ORDER:
        score = scores[name]
        add_tile(slide, x, cursor, tile_w, tile_h, name, f"{score:+d}" if score else '0', ONYX)
        x += tile_w + tile_gap
    add_tile(slide, x, cursor, tile_w, tile_h, 'Total', f"{t['total']:+d}" if t['total'] else '0', ORANGE)
    cursor += tile_h + GAP

    caption = f"Fit: {t['fit']}  |  Decision date: {t['decision_date']}"
    cursor += body(caption, cursor, 230000)
    if t.get('note'):
        cursor += body(t['note'], cursor, 280000)
    cursor += GAP

    # footer note position: beside the layout's own "Confidential and
    # Proprietary" footer shape, same row, never overlapping it. On this
    # master that shape is named "Footer Placeholder" but is not an actual
    # <p:ph> placeholder, so it must be found via .shapes, not .placeholders.
    layout_footer = next(
        (sh for sh in slide.slide_layout.shapes if 'footer' in sh.name.lower() and sh.has_text_frame), None
    )
    if layout_footer is not None:
        footer_left = layout_footer.left + layout_footer.width + Emu(300000)
        footer_top = layout_footer.top
        # the master's own footer shape overshoots the slide by a few EMU;
        # clamp ours so it stays fully on-slide regardless
        footer_height = min(layout_footer.height, slide_h - footer_top)
    else:
        footer_left, footer_top, footer_height = margin, slide_h - Emu(400000), Emu(300000)

    # --- Context --- (bullets box stops a clear gap above the footer row,
    # so it can never overlap the footer note or "Confidential and
    # Proprietary", however many bullets or how much text is in them)
    cursor += heading('CONTEXT', cursor) + 60000
    bullets_h = max(400000, int(footer_top) - int(cursor) - GAP)
    bullets_box = slide.shapes.add_textbox(Emu(margin), Emu(cursor), Emu(content_w), Emu(bullets_h))
    btf = bullets_box.text_frame
    btf.word_wrap = True
    for i, b in enumerate(fields['context_bullets']):
        p = btf.paragraphs[0] if i == 0 else btf.add_paragraph()
        run = p.add_run()
        run.text = '\u2022 ' + b
        run.font.name = FONT
        run.font.size = Pt(13)
        run.font.color.rgb = SLATE

    footer_width = slide_w - margin - footer_left
    footer = f"Source: {fields['footer_source']}    {fields['footer_date']}"
    add_textbox(slide, footer_left, footer_top, footer_width, footer_height, footer, 10, SLATE, italic=True)

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
