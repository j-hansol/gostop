"""Adobe Illustrator (AI5~AI10 PostScript) 본문을 SVG 도형 목록으로 변환한다.

사용: python -P ai2svg.py <private.ps> <out_dir>
출력: full.svg (시트 전체), shapes.json (도형별 d/fill/stroke/bbox)
"""
import json
import re
import sys

src, out_dir = sys.argv[1], sys.argv[2]
text = open(src, 'rb').read().decode('latin-1').replace('\r', '\n')
body = text.split('%AI5_BeginLayer', 1)[1].split('%AI5_EndLayer', 1)[0]


def cmyk(c, m, y, k):
    r = round(255 * (1 - c) * (1 - k))
    g = round(255 * (1 - m) * (1 - k))
    b = round(255 * (1 - y) * (1 - k))
    return f'#{r:02x}{g:02x}{b:02x}'


def rgb(r, g, b):
    return f'#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}'


shapes = []
fill = '#000000'
stroke = '#000000'
width = 1.0
evenodd = False
d = []
bbox = [1e9, 1e9, -1e9, -1e9]
compound = 0
last_paint = None


def pt(x, y):
    x, y = float(x), -float(y)
    bbox[0] = min(bbox[0], x); bbox[1] = min(bbox[1], y)
    bbox[2] = max(bbox[2], x); bbox[3] = max(bbox[3], y)
    return f'{x:.2f} {y:.2f}'


def emit(op):
    global d, bbox
    if not d:
        return
    f = op in ('f', 'F', 'b', 'B')
    s = op in ('s', 'S', 'b', 'B')
    close = op in ('f', 's', 'b')
    path = ' '.join(d) + (' Z' if close else '')
    shapes.append({
        'd': path,
        'fill': fill if f else None,
        'stroke': stroke if s else None,
        'width': width,
        'evenodd': evenodd,
        'bbox': [round(v, 2) for v in bbox],
    })
    d = []
    bbox = [1e9, 1e9, -1e9, -1e9]


for raw in body.split('\n'):
    ln = raw.strip()
    if not ln or ln.startswith('%'):
        continue
    if ln.startswith('('):
        continue  # 레이어 이름 등 문자열
    parts = ln.split()
    op, a = parts[-1], parts[:-1]
    if op == 'm':
        d.append('M' + pt(*a))
    elif op in ('l', 'L'):
        d.append('L' + pt(*a))
    elif op in ('c', 'C'):
        d.append('C' + pt(a[0], a[1]) + ' ' + pt(a[2], a[3]) + ' ' + pt(a[4], a[5]))
    elif op in ('v', 'V'):
        # 첫 제어점 = 현재점: 근사로 현재점 대신 두 번째 제어점 사용
        d.append('C' + pt(a[0], a[1]) + ' ' + pt(a[0], a[1]) + ' ' + pt(a[2], a[3]))
    elif op in ('y', 'Y'):
        d.append('C' + pt(a[0], a[1]) + ' ' + pt(a[2], a[3]) + ' ' + pt(a[2], a[3]))
    elif op in ('f', 'F', 's', 'S', 'b', 'B', 'n', 'N'):
        if compound:
            last_paint = op
            if op in ('f', 's', 'b'):
                d.append('Z')
        elif op in ('n', 'N'):
            d = []
            bbox = [1e9, 1e9, -1e9, -1e9]
        else:
            emit(op)
    elif op == '*u':
        compound += 1
    elif op == '*U':
        compound -= 1
        if compound == 0 and last_paint:
            emit(last_paint.upper() if last_paint in ('f', 's', 'b') else last_paint)
            last_paint = None
    elif op == 'k':
        fill = cmyk(*map(float, a[:4]))
    elif op == 'K':
        stroke = cmyk(*map(float, a[:4]))
    elif op == 'g':
        fill = rgb(*[float(a[0])] * 3)
    elif op == 'G':
        stroke = rgb(*[float(a[0])] * 3)
    elif op == 'Xa':
        fill = rgb(*map(float, a[:3]))
    elif op == 'XA':
        stroke = rgb(*map(float, a[:3]))
    elif op == 'w':
        width = float(a[0])
    elif op == 'XR':
        evenodd = a[0] == '1'

minx = min(s['bbox'][0] for s in shapes)
miny = min(s['bbox'][1] for s in shapes)
maxx = max(s['bbox'][2] for s in shapes)
maxy = max(s['bbox'][3] for s in shapes)


def to_svg(items):
    out = []
    for s in items:
        attrs = f'd="{s["d"]}"'
        attrs += f' fill="{s["fill"]}"' if s['fill'] else ' fill="none"'
        if s['evenodd'] and s['fill']:
            attrs += ' fill-rule="evenodd"'
        if s['stroke']:
            attrs += f' stroke="{s["stroke"]}" stroke-width="{s["width"]}"'
        out.append(f'<path {attrs}/>')
    return '\n'.join(out)


with open(f'{out_dir}/full.svg', 'w', encoding='utf-8') as fp:
    fp.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{minx:.1f} {miny:.1f} {maxx - minx:.1f} {maxy - miny:.1f}">\n')
    fp.write(f'<rect x="{minx}" y="{miny}" width="{maxx - minx}" height="{maxy - miny}" fill="#ddd"/>\n')
    fp.write(to_svg(shapes))
    fp.write('\n</svg>\n')
json.dump(shapes, open(f'{out_dir}/shapes.json', 'w'))
print('shapes', len(shapes), 'bbox', minx, miny, maxx, maxy)
