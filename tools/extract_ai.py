"""일러스트레이터(.ai) 파일에서 AIPrivateData(PostScript 본문)를 꺼낸다.

사용: python -P extract_ai.py <file.ai> <out.ps>   (PyMuPDF 필요)
이후: python -P ai2svg.py <out.ps> <dir>  →  python -P split.py <dir>/shapes.json public/cards
"""
import sys

import fitz

doc = fitz.open(sys.argv[1])
key = next(
    int(doc.xref_get_key(x, 'AIPrivateData1')[1].split()[0])
    for x in range(1, doc.xref_length())
    if doc.xref_get_key(x, 'AIPrivateData1')[0] == 'xref'
)
open(sys.argv[2], 'wb').write(doc.xref_stream(key))
print('extracted', key)
