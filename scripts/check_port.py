"""Verify index.html + assets are a faithful port of docs/source/request-intake-mockup.html.

Compares (mockup vs new files):
  1. Sequence of visible text nodes in the body.
  2. All element attributes except <img src>.
  3. mockup <style> body vs assets/styles.css (whitespace-normalised).
  4. mockup <script> body vs assets/app.js (whitespace-normalised).

Run: python scripts/check_port.py
"""
import re
import sys
from html.parser import HTMLParser

MOCKUP = 'docs/source/request-intake-mockup.html'
INDEX = 'index.html'
CSS = 'assets/styles.css'
JS = 'assets/app.js'


class Walker(HTMLParser):
    """Collects (tag, attrs-without-src) events and text nodes, skipping style/script."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.events = []
        self.texts = []
        self._skip_depth = 0
        self._skip_tag = None

    def handle_starttag(self, tag, attrs):
        if tag in ('style', 'script'):
            self._skip_depth += 1
            self._skip_tag = tag
            return
        if tag == 'link' and ('rel', 'stylesheet') in attrs:
            # the port's external stylesheet link has no mockup equivalent (was inline <style>)
            return
        if self._skip_depth:
            return
        attrs = sorted((k, v) for k, v in attrs if not (tag == 'img' and k == 'src'))
        self.events.append(('start', tag, attrs))

    def handle_startendtag(self, tag, attrs):
        if self._skip_depth:
            return
        attrs = sorted((k, v) for k, v in attrs if not (tag == 'img' and k == 'src'))
        self.events.append(('start', tag, attrs))
        self.events.append(('end', tag))

    def handle_endtag(self, tag):
        if tag in ('style', 'script') and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._skip_depth:
            return
        self.events.append(('end', tag))

    def handle_data(self, data):
        if self._skip_depth:
            return
        text = data.strip()
        if text:
            self.texts.append(text)
            self.events.append(('text', text))


def parse(path):
    html = open(path, encoding='utf-8').read()
    w = Walker()
    w.feed(html)
    return w


def extract_block(path, tag):
    src = open(path, encoding='utf-8').read()
    m = re.search(r'<%s>\n(.*?)</%s>' % (tag, tag), src, re.S)
    return m.group(1) if m else None


def norm_ws(s):
    return re.sub(r'\s+', ' ', s).strip()


def main():
    failures = []

    mock = parse(MOCKUP)
    idx = parse(INDEX)

    if mock.events != idx.events:
        failures.append('DOM events (text/attrs, excluding img src) differ between mockup and index.html')
        # show first divergence for debugging
        for i, (a, b) in enumerate(zip(mock.events, idx.events)):
            if a != b:
                failures.append('  first diff at index %d:\n    mockup: %r\n    index:  %r' % (i, a, b))
                break
        else:
            failures.append('  length differs: mockup=%d index=%d' % (len(mock.events), len(idx.events)))

    mock_style = extract_block(MOCKUP, 'style')
    new_css = open(CSS, encoding='utf-8').read()
    if norm_ws(mock_style) != norm_ws(new_css):
        failures.append('style block vs assets/styles.css differ (whitespace-normalised)')

    mock_script = extract_block(MOCKUP, 'script')
    new_js = open(JS, encoding='utf-8').read()
    if norm_ws(mock_script) != norm_ws(new_js):
        failures.append('script block vs assets/app.js differ (whitespace-normalised)')

    if failures:
        print('FAIL')
        for f in failures:
            print(f)
        sys.exit(1)
    print('PASS: index.html, styles.css and app.js are a faithful port of the mockup.')


if __name__ == '__main__':
    main()
