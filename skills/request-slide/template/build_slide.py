#!/usr/bin/env python3
"""Fixed-template management slide builder.

Usage: python build_slide.py <fields.json> <out.pptx>

Every slide uses the same layout, Arial, and Compass colors. Only the text
in `fields.json` changes between requests. See SKILL.md for the field list.

Word budgets are enforced here (not left to the caller) so a slide can never
ship with overflow text silently truncated by auto-shrink: this script fails
loudly instead. The skill must shorten text itself before calling this.
"""
import json
import sys
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

ONYX = RGBColor(0x14, 0x1E, 0x27)
SLATE = RGBColor(0x34, 0x44, 0x4D)
ORANGE = RGBColor(0xF3, 0x78, 0x20)
ORANGE_SMALL = RGBColor(0xB3, 0x53, 0x0C)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = 'Arial'

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)
LOGO_PATH = Path(__file__).resolve().parent.parent / 'assets' / 'compass-logo.png'

# word budgets: (field path in JSON, max words)
WORD_BUDGETS = [
    ('ask', 30),
    ('who_how_often', 20),
    ('context_bullets_total', 40),  # all bullets combined
]


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


def add_textbox(slide, left, top, width, height, text, size, color, bold=False, align=PP_ALIGN.LEFT, italic=False):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.font.bold = bold
    run.font.italic = italic
    return box


def build(fields, out_path):
    check_budgets(fields)

    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank

    # white background
    bg = slide.background
    bg.fill.solid()
    bg.fill.fore_color.rgb = WHITE

    # onyx title band
    band = slide.shapes.add_shape(1, Emu(0), Emu(0), SLIDE_W, Inches(1.0))
    band.fill.solid()
    band.fill.fore_color.rgb = ONYX
    band.line.fill.background()
    title = f"{fields['title_name']} — {fields['disposition']}"
    add_textbox(slide, Inches(0.4), Inches(0.12), Inches(9.5), Inches(0.75), title, 24, WHITE, bold=True)

    # orange accent rule under the band
    rule = slide.shapes.add_shape(1, Emu(0), Inches(1.0), SLIDE_W, Pt(4))
    rule.fill.solid()
    rule.fill.fore_color.rgb = ORANGE
    rule.line.fill.background()

    # logo, top-right
    if LOGO_PATH.exists():
        slide.shapes.add_picture(str(LOGO_PATH), Inches(11.5), Inches(0.15), height=Inches(0.7))

    def heading(text, top):
        return add_textbox(slide, Inches(0.4), top, Inches(6.5), Inches(0.3), text, 13, ORANGE_SMALL, bold=True)

    def body(text, top, height=Inches(0.8), width=Inches(12.5)):
        return add_textbox(slide, Inches(0.4), top, width, height, text, 14, SLATE)

    heading('THE ASK', Inches(1.25))
    body(fields['ask'], Inches(1.55), height=Inches(0.6))

    heading('WHO AND HOW OFTEN', Inches(2.25))
    body(fields['who_how_often'], Inches(2.55), height=Inches(0.5))

    t = fields['triage']
    heading('TRIAGE', Inches(3.15))
    triage_line = (
        f"Cost {t['cost']}  Risk {t['risk']}  Time {t['time']}  Benefit {t['benefit']}  "
        f"Total {t['total']}  |  Fit: {t['fit']}  |  Decision date: {t['decision_date']}"
    )
    body(triage_line, Inches(3.45), height=Inches(0.35))
    if t.get('note'):
        body(t['note'], Inches(3.8), height=Inches(0.4))

    heading('CONTEXT', Inches(4.35))
    bullets_box = slide.shapes.add_textbox(Inches(0.4), Inches(4.65), Inches(12.5), Inches(1.6))
    tf = bullets_box.text_frame
    tf.word_wrap = True
    for i, b in enumerate(fields['context_bullets']):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        run = p.add_run()
        run.text = '• ' + b
        run.font.name = FONT
        run.font.size = Pt(13)
        run.font.color.rgb = SLATE

    footer = f"Source: {fields['footer_source']}    {fields['footer_date']}"
    add_textbox(slide, Inches(0.4), Inches(7.1), Inches(10), Inches(0.3), footer, 10, SLATE, italic=True)

    # speaker notes: sources with title, link, date; unverified claims marked
    notes = slide.notes_slide
    lines = []
    for s in fields.get('notes_sources', []):
        tag = ' (unverified)' if s.get('unverified') else ''
        lines.append(f"[{s['n']}] {s['title']} — {s.get('link','')} — {s.get('date','')}{tag}")
    notes.notes_text_frame.text = '\n'.join(lines)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out_path))
    return out_path


def main():
    if len(sys.argv) != 3:
        print('Usage: python build_slide.py <fields.json> <out.pptx>', file=sys.stderr)
        sys.exit(2)
    fields = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    build(fields, sys.argv[2])


if __name__ == '__main__':
    main()
