"""shapes.json을 카드 48장으로 나눠 <id>.svg 파일로 저장한다.

사용: python -P split.py <shapes.json> <out_dir>
카드 테두리(빨간 사각형, 약 153×238)를 찾아 12행×4열로 정렬한다.
맨 위 행이 12월, 맨 아래 행이 1월이며 열 순서가 엔진의 카드 순서(월 내 0~3)와 같다.
"""
import json
import re
import sys

shapes = json.load(open(sys.argv[1]))
out_dir = sys.argv[2]

frames = []
for i, s in enumerate(shapes):
    x0, y0, x1, y1 = s['bbox']
    w, h = x1 - x0, y1 - y0
    if s['fill'] and 140 < w < 170 and 225 < h < 250:
        frames.append((i, s['bbox']))

# 같은 자리의 중복 프레임 제거 (테두리 바깥/안쪽 사각형이 겹칠 수 있다)
cards = []
for i, b in frames:
    if any(abs(b[0] - c[1][0]) < 20 and abs(b[1] - c[1][1]) < 20 for c in cards):
        continue
    cards.append((i, b))
print('frames', len(frames), 'cards', len(cards))
assert len(cards) == 48, len(cards)

rows = sorted({round(b[1] / 50) for _, b in cards})
cards.sort(key=lambda c: (round(c[1][1] / 50), c[1][0]))

num = re.compile(r'-?\d+\.\d+')


def shorten(d):
    return num.sub(lambda m: f'{float(m.group()):.1f}'.rstrip('0').rstrip('.'), d)


for idx, (_, b) in enumerate(cards):
    row, col = divmod(idx, 4)
    month = 12 - row
    cid = (month - 1) * 4 + col
    x0, y0, x1, y1 = b
    inside = []
    for s in shapes:
        sx0, sy0, sx1, sy1 = s['bbox']
        cx, cy = (sx0 + sx1) / 2, (sy0 + sy1) / 2
        if x0 - 1 <= cx <= x1 + 1 and y0 - 1 <= cy <= y1 + 1:
            inside.append(s)
    parts = []
    for s in inside:
        a = f'd="{shorten(s["d"])}"'
        a += f' fill="{s["fill"]}"' if s['fill'] else ' fill="none"'
        if s['evenodd'] and s['fill']:
            a += ' fill-rule="evenodd"'
        if s['stroke']:
            a += f' stroke="{s["stroke"]}" stroke-width="{s["width"]}"'
        parts.append(f'<path {a}/>')
    vb = f'{x0:.1f} {y0:.1f} {x1 - x0:.1f} {y1 - y0:.1f}'
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" preserveAspectRatio="none">'
           f'<defs><clipPath id="c"><rect x="{x0:.1f}" y="{y0:.1f}" width="{x1 - x0:.1f}" height="{y1 - y0:.1f}" rx="6"/></clipPath></defs>'
           f'<g clip-path="url(#c)">{"".join(parts)}</g></svg>')
    open(f'{out_dir}/{cid}.svg', 'w', encoding='utf-8').write(svg)
    print(cid, f'{month}월', len(inside), len(svg))
