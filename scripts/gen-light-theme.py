#!/usr/bin/env python3
"""Generates public/admin-light.css: the admin app's light theme.

The admin stylesheet is dark (ClickUp style) with hard-coded colours. This script reads the inline <style> of
public/admin.html and, for every rule that uses a neutral/dark surface colour or a light text colour, emits the same rule
under  html[data-theme="light"]  with colours mapped to the light palette:
    page #f8f9fa · sidebar/cards #ffffff (border #e5e7eb) · text #111827 · secondary #6b7280 · inputs #f9fafb (border #d1d5db)
Run again after changing the admin CSS:   python3 scripts/gen-light-theme.py
"""
import colorsys, re, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
html = (root / 'public' / 'admin.html').read_text(encoding='utf-8')
css = re.findall(r'<style[^>]*>(.*?)</style>', html, re.S)[0]
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)

HEX = re.compile(r'#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])')
RGBA = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)')
def parse_hex(h):
    h = h.lstrip('#')
    if len(h) in (3, 4): h = ''.join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), (int(h[6:8], 16) / 255 if len(h) == 8 else 1)
def hexs(r, g, b): return '#%02x%02x%02x' % (max(0, min(255, round(r))), max(0, min(255, round(g))), max(0, min(255, round(b))))

def map_color(r, g, b, kind):
    """kind: bg | text | border  → replacement colour or None (leave alone)"""
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    sat_neutral = (max(r, g, b) - min(r, g, b)) <= 26
    lum = (0.299 * r + 0.587 * g + 0.114 * b)
    if kind == 'text':
        if sat_neutral:
            if lum >= 0xe0: return '#111827'
            if lum >= 0xc0: return '#1f2937'
            if lum >= 0xa0: return '#374151'
            if lum >= 0x70: return '#6b7280'
            if lum >= 0x40: return '#6b7280'
            return None                                  # already dark text
        if l > 0.62 and s > 0.25: return hexs(*[c * 255 for c in colorsys.hls_to_rgb(h, 0.34, min(.55, s))])   # pastel-on-dark → deep tone
        if l > 0.42 and s > 0.45 and l <= 0.62: return hexs(*[c * 255 for c in colorsys.hls_to_rgb(h, 0.36, min(.65, s))])
        return None
    # surfaces + borders
    if sat_neutral:
        if lum > 0xd0: return None                        # already light
        if kind == 'bg':
            if lum <= 0x0e: return '#f8f9fa'              # page
            if lum <= 0x21: return '#ffffff'              # sidebar / cards / panels
            if lum <= 0x2c: return '#f3f4f6'              # hover / subtle
            if lum <= 0x40: return '#e5e7eb'
            if lum <= 0x60: return '#d1d5db'
            return None
        if lum <= 0x2c: return '#e5e7eb'
        if lum <= 0x60: return '#d1d5db'
        return None
    if l < 0.30 and s > 0.15:                             # dark tinted notice surface → pale tint of the same hue
        return hexs(*[c * 255 for c in colorsys.hls_to_rgb(h, 0.93, min(1, max(s, .55)))])
    return None

def map_value(prop, value):
    kind = 'text' if prop in ('color', 'fill', 'stroke', 'caret-color', 'text-decoration-color') else 'bg' if prop.startswith('background') else 'border' if prop.startswith(('border', 'outline', 'column-rule')) else 'shadow' if prop == 'box-shadow' else None
    if not kind or 'gradient' in value or 'var(' in value and kind != 'shadow' and not HEX.search(value) and not RGBA.search(value): return None
    if kind == 'shadow': return None
    if 'gradient' in value: return None
    changed = False
    def hx(m):
        nonlocal changed
        r, g, b, a = parse_hex(m.group(0)); n = map_color(r, g, b, kind)
        if n is None: return m.group(0)
        changed = True; return n
    def rg(m):
        nonlocal changed
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3)); a = m.group(4)
        n = map_color(r, g, b, kind)
        if n is None: return m.group(0)
        changed = True; nr, ng, nb, _ = parse_hex(n); return 'rgba(%d,%d,%d,%s)' % (nr, ng, nb, a) if a is not None else n
    v = RGBA.sub(rg, HEX.sub(hx, value))
    return v if changed else None

ACCENT_BG = re.compile(r'background(?:-color)?\s*:\s*(?:var\(--(?:teal|navy|red|green|amber|blue|gold)\)|#(?:7c3aed|6d28d9|ef4444|22c55e|06b6d4|f59e0b|3b82f6|d4a017|b8860b|a37507|dc2626))', re.I)

KEEP_TEXT = re.compile(r'(?:^|[\s.>#:\[-])(?:av|avatar|logo|nbadge|pill|spill|sq|circ|fab|rc-av|rc-badge|stack|plus|dot|toast)(?![a-zA-Z0-9_])')

def convert_rule(sel, body):
    if KEEP_TEXT.search(sel): body = re.sub(r'(?:^|;)\s*(?:color|fill|stroke)\s*:[^;]*', '', body)   # text on coloured chips / avatars stays white
    decls = [d.strip() for d in re.split(r';(?![^()]*\))', body) if d.strip()]
    saturated_bg = any(re.match(r'background', d) and ACCENT_BG.search(d) for d in decls) or any('gradient' in d and d.startswith('background') for d in decls)
    out = []
    for d in decls:
        if ':' not in d: continue
        prop, val = d.split(':', 1); prop = prop.strip().lower(); val = val.strip(); imp = ''
        if val.endswith('!important'): val = val[:-10].strip(); imp = ' !important'
        if saturated_bg and prop in ('color', 'fill', 'stroke'): continue   # text on a coloured surface stays as designed
        if prop == 'color' and re.fullmatch(r'#(?:fff|ffffff)', val, re.I) and re.search(r'\.(?:on|active|sel|selected|current)(?![a-zA-Z0-9_-])', sel): continue   # white label of a selected (accent) state
        nv = map_value(prop, val)
        if nv is not None: out.append('%s:%s%s' % (prop, nv, imp))
    return out

def scope(sel):
    parts = [p.strip() for p in re.split(r',(?![^()]*\))', sel) if p.strip()]
    res = []
    for p in parts:
        if p.startswith(('html', ':root')) or p == 'body' or p == '*': res.append('html[data-theme="light"] ' + p.replace('html', '', 1).strip() if p.startswith('html') and False else 'html[data-theme="light"] ' + p)
        else: res.append('html[data-theme="light"] ' + p)
    return ', '.join(res)

def walk(text, skip_print=True):
    out, i, n = [], 0, len(text)
    while i < n:
        j = text.find('{', i)
        if j < 0: break
        head = text[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            depth += {'{': 1, '}': -1}.get(text[k], 0); k += 1
        inner = text[j + 1:k - 1]; i = k
        if head.startswith('@media'):
            if 'print' in head and skip_print: continue
            sub = walk(inner)
            if sub: out.append(head + '{' + sub + '}')
        elif head.startswith('@'): continue
        else:
            decls = convert_rule(head, inner)
            if decls: out.append(scope(head) + '{' + ';'.join(decls) + '}')
    return '\n'.join(out)

# the :root dark token block and html/body background are handled by theme.css variables → still convert body/html rules
body = walk(css)
header = '/* GENERATED by scripts/gen-light-theme.py — do not edit by hand. Light palette for the admin app. */\n'
(root / 'public' / 'admin-light.css').write_text(header + body + '\n', encoding='utf-8')
print('rules:', body.count('\n') + 1, 'bytes:', len(body))
