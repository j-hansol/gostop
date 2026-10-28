// 블로그(티스토리 등) 글에 그대로 붙여 넣을 HTML을 만든다.
//   npm run build:blog → dist/blog-post.html (글 HTML 모드에 붙여 넣을 내용)
//                        dist/blog-preview.html (로컬 확인용 가짜 블로그 페이지)
// 게임 전체(HTML·CSS·JS·카드 SVG)를 문자열 하나로 묶어 iframe srcdoc으로 띄운다.
// 팝업은 closed Shadow DOM 안에 두어 블로그 스타일과 서로 영향을 주지 않는다.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');

// ───────────── 카드 SVG 줄이기 ─────────────
// 변환된 SVG는 절대 좌표(소수 1자리)라 숫자가 길다. 0.1 단위 정수로 바꿔
// 원점을 옮기고 상대 좌표 명령으로 다시 쓰면 오차 없이 크기가 크게 준다.

const fmt = (tenths) => {
  const neg = tenths < 0;
  const a = Math.abs(tenths);
  let s = a % 10 === 0 ? String(a / 10) : (a / 10).toFixed(1);
  if (s.startsWith('0.')) s = s.slice(1);
  return neg ? `-${s}` : s;
};

function joinNums(nums) {
  let out = '';
  for (const s of nums) {
    if (out && !s.startsWith('-') && !(s.startsWith('.') && /\.\d*$/.test(out))) out += ' ';
    out += s;
  }
  return out;
}

const toTenths = (v) => Math.round(Number(v) * 10);

function optimizePath(d, ox, oy) {
  const tokens = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?/g);
  let out = '';
  let cx = 0, cy = 0, sx = 0, sy = 0, last = '';
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'Z' || cmd === 'z') {
      out += 'z';
      cx = sx; cy = sy; last = 'z';
      continue;
    }
    const n = cmd === 'C' ? 6 : 2;
    while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
      const pts = tokens.slice(i, i + n).map(toTenths);
      i += n;
      for (let k = 0; k < n; k += 2) { pts[k] -= ox; pts[k + 1] -= oy; }
      if (cmd === 'M' && last === '') {
        // 첫 이동은 절대 좌표 (원점 기준)
        out += 'M' + joinNums([fmt(pts[0]), fmt(pts[1])]);
        cx = sx = pts[0]; cy = sy = pts[1]; last = 'M';
        continue;
      }
      const rel = pts.map((v, k) => v - (k % 2 === 0 ? cx : cy));
      const letter = cmd.toLowerCase();
      const nums = rel.map(fmt);
      out += (letter === last && letter !== 'm' ? (nums[0].startsWith('-') ? '' : ' ') : letter) + joinNums(nums);
      cx = pts[n - 2]; cy = pts[n - 1];
      if (cmd === 'M') { sx = cx; sy = cy; }
      last = letter;
    }
  }
  return out;
}

function shortColor(c) {
  const m = /^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i.exec(c);
  return m ? `#${m[1]}${m[2]}${m[3]}` : c;
}

function optimizeSvg(svg) {
  const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(toTenths);
  const [ox, oy, w, h] = vb;
  return svg
    .replace(/viewBox="[^"]+"/, `viewBox="0 0 ${fmt(w)} ${fmt(h)}"`)
    .replace(/<rect x="[^"]+" y="[^"]+"/, '<rect')
    .replace(/ d="([^"]+)"/g, (_, d) => ` d="${optimizePath(d, ox, oy)}"`)
    .replace(/(fill|stroke)="(#[0-9a-f]{6})"/gi, (_, a, c) => `${a}="${shortColor(c)}"`);
}

// ───────────── 게임 문서 조립 ─────────────

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const jsPath = /<script defer src="\.\/([^"]+)"><\/script>/.exec(html)[1];
const cssPath = /<link rel="stylesheet" href="\.\/([^"]+)">/.exec(html)[1];
const js = readFileSync(join(dist, jsPath), 'utf8');
const css = readFileSync(join(dist, cssPath), 'utf8');

const cardDir = join(root, 'public', 'cards');
const ids = readdirSync(cardDir).filter((f) => /^\d+\.svg$/.test(f)).map((f) => Number(f.slice(0, -4)));
const cards = [];
let before = 0;
for (const id of ids) {
  const raw = readFileSync(join(cardDir, `${id}.svg`), 'utf8');
  before += raw.length;
  cards[id] = optimizeSvg(raw);
}
const after = cards.reduce((a, s) => a + (s?.length ?? 0), 0);

// 인라인 <script> 안에서 문서가 끊기지 않도록 '<'를 이스케이프
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const safeScript = (s) => s.replace(/<\/script/gi, '<\\/script');

const gameDoc = html
  .replace(/<script defer src="[^"]+"><\/script>\s*/, '')
  .replace(/<link rel="stylesheet" href="[^"]+">/, () => `<style>${css}</style>`)
  .replace('</body>', () =>
    `<script>window.__GOSTOP_EMBED=true;window.__GOSTOP_CARDS=${safeJson(cards)};</script>` +
    `<script>${safeScript(js)}</script></body>`);

// ───────────── 블로그 글 (실행 버튼 + 전체 화면 팝업) ─────────────

const launcher = `(() => {
  'use strict';
  const gameDocument = ${safeJson(gameDoc)};
  const anchor = document.currentScript;
  const button = document.createElement('gostop-launcher');
  const bShadow = button.attachShadow({ mode: 'closed' });
  bShadow.innerHTML = \`
    <style>
      :host{all:initial;display:block;margin:24px 0;text-align:center}
      button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:10px;padding:16px 30px;border-radius:14px;
        background:linear-gradient(180deg,#1f5e38,#0f3a22);color:#fff;font:700 18px/1.2 system-ui,-apple-system,'Malgun Gothic',sans-serif;
        cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);border:2px solid #f6c51d}
      button:hover{filter:brightness(1.12)}
      button:focus-visible{outline:3px solid #f6c51d;outline-offset:3px}
      .chip{display:inline-block;width:22px;height:34px;border-radius:4px;background:#e3232c;border:2px solid #fff;transform:rotate(-8deg)}
    </style>
    <button type="button"><span class="chip"></span>맞고 게임 시작</button>\`;
  anchor.after(button);

  let host = null;
  let saved = null;
  const open = () => {
    if (host) return;
    host = document.createElement('gostop-popup');
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = \`
      <style>
        :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;background:#0b2a17!important}
        iframe{display:block;position:absolute;inset:0;width:100%;height:100%;border:0;background:#0b2a17}
      </style>
      <iframe title="맞고" sandbox="allow-scripts allow-same-origin allow-modals" allow="autoplay"></iframe>\`;
    document.body.append(host);
    // 팝업이 떠 있는 동안 뒤쪽 블로그 화면이 스크롤되지 않게 한다
    const de = document.documentElement;
    saved = [de.style.overflow, document.body.style.overflow];
    de.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const frame = shadow.querySelector('iframe');
    const onMessage = (e) => {
      if (e.source === frame.contentWindow && e.data && e.data.type === 'gostop-close') close();
    };
    window.addEventListener('message', onMessage);
    host.cleanup = () => window.removeEventListener('message', onMessage);
    frame.srcdoc = gameDocument;
    frame.focus();
  };
  const close = () => {
    if (!host) return;
    host.cleanup();
    host.remove();
    host = null;
    document.documentElement.style.overflow = saved[0];
    document.body.style.overflow = saved[1];
  };
  bShadow.querySelector('button').addEventListener('click', open);
})();`;

const post = `<script>\n${launcher}\n</script>\n`;
writeFileSync(join(dist, 'blog-post.html'), post);

// 로컬 확인용: 일부러 스타일이 강한 가짜 블로그 페이지에 글을 넣는다
const preview = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>블로그 미리보기</title>
<style>
  body{margin:0;font:16px/1.8 serif;background:#fafafa;color:#333}
  header{position:sticky;top:0;z-index:1000;background:#333;color:#fff;padding:14px 20px}
  article{max-width:720px;margin:30px auto;padding:0 16px}
  button{background:hotpink!important;font-size:30px!important}
  iframe{border:10px solid red!important;width:50%!important}
  p{margin:1.5em 0}
</style></head>
<body><header>내 블로그</header><article><h1>맞고 게임</h1><p>아래 버튼을 눌러 게임을 시작하세요.</p>
${post}
${Array.from({ length: 30 }, (_, i) => `<p>스크롤 확인용 문단 ${i + 1}</p>`).join('\n')}
</article></body></html>`;
writeFileSync(join(dist, 'blog-preview.html'), preview);

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`카드 SVG ${kb(before)} → ${kb(after)}`);
console.log(`dist/blog-post.html ${kb(Buffer.byteLength(post))} (글 HTML 모드에 붙여 넣기)`);
console.log('dist/blog-preview.html (로컬 확인용)');
