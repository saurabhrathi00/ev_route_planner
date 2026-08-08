"""Markdown to HTML, small and sufficient for the two legal documents.

Shared by the app build and the docs build so the page a store reviewer opens
and the text on the phone come out of one converter.
"""
import re, html as _h

def md_to_html(path):
    out, lines = [], open(path, encoding='utf-8').read().split('\n')
    i, in_ul, in_tbl = 0, False, False
    def inline(t):
        t = _h.escape(t)
        # A link to another markdown file is useful in the repository and dead
        # on a phone, where the file does not exist. The words survive; the
        # link does not.
        t = re.sub(r'\[([^\]]+)\]\((?![a-z]+:)[^)]*\.md[^)]*\)', r'\1', t)
        t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)',
                   lambda m: f'<a href="{m.group(2)}" target="_blank" rel="noopener">{m.group(1)}</a>', t)
        t = re.sub(r'<(https?://[^>]+)>', r'<a href="\1">\1</a>', t)
        t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
        t = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', t)
        return t
    def shut():
        nonlocal in_ul, in_tbl
        if in_ul: out.append('</ul>'); in_ul = False
        if in_tbl: out.append('</tbody></table></div>'); in_tbl = False
    while i < len(lines):
        ln = lines[i].rstrip(); i += 1
        if not ln.strip():
            shut(); continue
        if ln.startswith('## '):
            shut(); out.append('<h2>' + inline(ln[3:]) + '</h2>'); continue
        if ln.startswith('# '):
            shut(); out.append('<h1>' + inline(ln[2:]) + '</h1>'); continue
        if ln.startswith('---'):
            shut(); out.append('<hr>'); continue
        if ln.startswith('- '):
            if not in_ul: shut(); out.append('<ul>'); in_ul = True
            out.append('<li>' + inline(ln[2:]) + '</li>'); continue
        if ln.startswith('|'):
            cells = [c.strip() for c in ln.strip('|').split('|')]
            if set(''.join(cells)) <= set('-: '):          # the header rule
                continue
            if not in_tbl:
                shut()
                out.append('<div class="docwrap"><table><thead><tr>'
                           + ''.join('<th>' + inline(c) + '</th>' for c in cells)
                           + '</tr></thead><tbody>')
                in_tbl = True
                continue
            out.append('<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in cells) + '</tr>')
            continue
        shut(); out.append('<p>' + inline(ln) + '</p>')
    shut()
    return '\n'.join(out)
