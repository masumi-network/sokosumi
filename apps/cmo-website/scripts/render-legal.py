"""Render the legal sources: headings, paragraphs, bullet lists and links."""
import argparse
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = ('terms', 'privacy', 'imprint', 'dpa')
COMPANY = json.loads((ROOT / 'legal' / 'company.json').read_text())

def representatives() -> str:
    representative = COMPANY['eu_representative']
    name, email = representative['name'], representative['email']
    return f'EU representative under GDPR Article 27: {name}, [{email}](mailto:{email}).'


def resolve(source: str) -> str:
    values = {**COMPANY, 'representatives': representatives()}
    return re.sub(r'\{\{([a-z_]+)\}\}', lambda match: values[match[1]], source)


def missing_facts(value: object) -> bool:
    if isinstance(value, dict):
        return any(missing_facts(item) for item in value.values())
    return value is None or value == '' or isinstance(value, str) and '[' in value


def inline(text: str) -> str:
    escaped = html.escape(text)
    return re.sub(r'\[([^\]\n]+)\]\(((?:https://|mailto:|/)[^\s)]+)\)',
                  r'<a href="\2">\1</a>', escaped)


def slug(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def render(source: str) -> tuple[str, str, str]:
    blocks, toc = [], []
    title = ''
    for block in source.strip().split('\n\n'):
        if block.startswith('# '):
            if title:
                raise ValueError('Only one title is allowed')
            title = block[2:]
        elif block.startswith('## '):
            heading = block[3:]
            anchor = slug(heading)
            if any(item[0] == anchor for item in toc):
                raise ValueError(f'Duplicate heading: {heading}')
            toc.append((anchor, heading))
            blocks.append(f'<h2 id="{anchor}">{inline(heading)}</h2>')
        elif block.startswith('- '):
            lines = block.splitlines()
            if not all(line.startswith('- ') for line in lines):
                raise ValueError('List items must each occupy one source line')
            blocks.append('<ul>' + ''.join(f'<li>{inline(line[2:])}</li>' for line in lines) + '</ul>')
        else:
            if block.startswith(('#', '```', '|', '>')):
                raise ValueError('Unsupported Markdown block')
            blocks.append(f'<p>{inline(block)}</p>')
    if not title or not toc:
        raise ValueError('A title and sections are required')
    contents = '<ol>' + ''.join(f'<li><a href="#{anchor}">{inline(label)}</a></li>' for anchor, label in toc) + '</ol>'
    return title, '\n'.join(blocks), contents


def page(name: str) -> str:
    title, content, contents = render(resolve((ROOT / 'legal' / f'{name}.md').read_text()))
    home = (ROOT / 'index.html').read_text()
    footer = re.search(r'  <footer\b.*?</footer>', home, re.S).group()
    footer = footer.replace('href="#', 'href="/#')
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{html.escape(title)} | CMO.XYZ</title>
  <meta name="description" content="{html.escape(title)} for CMO.XYZ, operated by {html.escape(COMPANY["name"])}" />
  <link rel="canonical" href="https://www.cmo.xyz/{name}" />
  <link rel="icon" type="image/svg+xml" href="/assets/icon.svg" />
  <meta name="color-scheme" content="light dark" />
  <script src="/legal-theme.js"></script>
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/legal.css" />
  <link rel="stylesheet" href="/cookie-consent.css" />
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="legal-header">
    <a class="brand" href="/" aria-label="CMO.XYZ home">
      <img class="brand__light" src="/assets/logo/cmo-xyz-lockup-stacked-text-black.svg" alt="" width="1032" height="393" />
      <img class="brand__dark" src="/assets/logo/cmo-xyz-lockup-stacked-text-white.svg" alt="" width="1044" height="393" />
    </a>
    <nav aria-label="Legal pages"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/imprint">Imprint</a><a href="/dpa">DPA</a></nav>
  </header>
  <main id="main" class="legal-document">
    <h1>{html.escape(title)}</h1>
    <nav class="legal-contents" aria-label="On this page"><h2>On this page</h2>{contents}</nav>
    <article aria-label="{html.escape(title)}">{content}</article>
  </main>
{footer}
  <script src="/script.js" defer></script>
  <script src="/cookie-consent.js" defer></script>
</body>
</html>
'''


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--release-check', action='store_true')
    args = parser.parse_args()
    if args.release_check and missing_facts(COMPANY):
        raise SystemExit('Fill legal/company.json before publishing legal pages.')
    assert inline('<script>') == '&lt;script&gt;'
    assert inline('[Privacy](/privacy)') == '<a href="/privacy">Privacy</a>'
    assert '<a ' not in inline('[bad](javascript:alert)')
    assert '[LEGAL EMAIL]' in inline('[LEGAL EMAIL]')
    for name in PAGES:
        target = ROOT / name / 'index.html'
        output = page(name)
        if args.check:
            if not target.exists() or target.read_text() != output:
                raise SystemExit(f'Stale page: {target}. Run python3 scripts/render-legal.py')
        else:
            target.parent.mkdir(exist_ok=True)
            target.write_text(output)
    print('Legal pages match their sources.' if args.check else 'Rendered four legal pages.')


if __name__ == '__main__':
    main()
