"""Self-check for build_slide.py: no framework, just asserts.

Run: python template/selfcheck_build_slide.py  (from skills/request-slide/)
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_slide  # noqa: E402

from pptx import Presentation

SAMPLE = Path(__file__).resolve().parent.parent / 'examples' / 'sample.json'


def shape_geometry(path):
    prs = Presentation(str(path))
    slide = prs.slides[0]
    return [(s.shape_type, s.left, s.top, s.width, s.height) for s in slide.shapes]


def check_idempotent():
    fields = json.loads(SAMPLE.read_text(encoding='utf-8'))
    with tempfile.TemporaryDirectory() as d:
        p1 = Path(d) / 'a.pptx'
        p2 = Path(d) / 'b.pptx'
        build_slide.build(fields, p1)
        build_slide.build(fields, p2)
        g1, g2 = shape_geometry(p1), shape_geometry(p2)
        assert g1 == g2, 'shape positions/sizes differ between two runs on the same JSON'
    print('ok: identical shape geometry across two runs')


def check_overflow_fails_loudly():
    fields = json.loads(SAMPLE.read_text(encoding='utf-8'))
    fields['ask'] = ' '.join(['word'] * 31)
    try:
        build_slide.check_budgets(fields)
    except ValueError as e:
        assert 'ask' in str(e)
        print('ok: over-budget ask raises ValueError')
        return
    raise AssertionError('expected ValueError for over-budget ask')


def _content_shapes(slide):
    """Shapes this script places or edits: the title, the score tiles
    (autoshape rectangles), and our text boxes. The master's background
    picture, footer, tagline, logo, and slide-number live on the layout
    only (not on the slide itself), so they never appear here and need no
    exclusion list. shape_type 1 = AUTO_SHAPE (tiles), 17 = TEXT_BOX."""
    for sh in slide.shapes:
        if sh.shape_type in (1, 17) or (sh.is_placeholder and sh.placeholder_format.idx == 0):
            yield sh


def _rects_overlap(a, b):
    al, at, aw, ah = a
    bl, bt, bw, bh = b
    return al < bl + bw and bl < al + aw and at < bt + bh and bt < at + ah


def check_geometry():
    fields = json.loads(SAMPLE.read_text(encoding='utf-8'))
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / 'g.pptx'
        build_slide.build(fields, out)
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


if __name__ == '__main__':
    check_idempotent()
    check_overflow_fails_loudly()
    check_geometry()
    print('all checks passed')
