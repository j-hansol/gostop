import { card, Card, TOTAL_CARDS } from '../engine/cards';

// 일반 패 48장은 화투 일러스트(.ai)에서 변환한 public/cards/<id>.svg를 쓴다.
// 보너스패·뒷면·빈 패는 여기서 직접 그린다.
const RED = '#e3232c';
const DRED = '#a8141b';
const BLK = '#111';
const YEL = '#f6c51d';
const WHT = '#fff';

const cardUrl = (id: number) => `${import.meta.env.BASE_URL}cards/${id}.svg`;

function frame(inner: string): string {
  return `<svg viewBox="0 0 120 192" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">` +
    `<rect width="120" height="192" rx="9" fill="${RED}"/>` +
    inner +
    `<rect x="6" y="6" width="108" height="180" rx="6" fill="none" stroke="${BLK}" stroke-width="1.4"/>` +
    `<rect x="0.8" y="0.8" width="118.4" height="190.4" rx="8.4" fill="none" stroke="${DRED}" stroke-width="1.2"/></svg>`;
}

function bonusArt(c: Card): string {
  const n = c.piValue;
  return frame(
    `<defs><linearGradient id="bg${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4b55"/><stop offset="1" stop-color="#b3121b"/></linearGradient></defs>` +
    `<rect x="6" y="6" width="108" height="180" rx="6" fill="url(#bg${n})"/>` +
    `<rect x="12" y="12" width="96" height="168" rx="4" fill="none" stroke="${YEL}" stroke-width="2"/>` +
    `<text x="60" y="36" font-size="14" text-anchor="middle" fill="${YEL}" font-weight="700" font-family="'Malgun Gothic',sans-serif">보너스</text>` +
    `<text x="60" y="130" font-size="96" text-anchor="middle" fill="${WHT}" font-weight="900" font-family="Georgia,serif" stroke="#5c0a10" stroke-width="2.4">${n}</text>` +
    `<text x="60" y="166" font-size="16" text-anchor="middle" fill="${WHT}" font-weight="700" font-family="'Malgun Gothic',sans-serif">${n === 2 ? '쌍피' : '쓰리피'}</text>`,
  );
}

const cache = new Map<number, string>();

/** 카드 앞면 마크업 */
export function cardSvg(id: number): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const c = card(id);
  const html = c.bonus ? bonusArt(c) : `<img src="${cardUrl(id)}" alt="${c.name}" draggable="false">`;
  cache.set(id, html);
  return html;
}

/** 첫 배분 때 깜빡이지 않도록 카드 그림을 미리 받아 둔다 */
export function preloadCards(): void {
  for (let id = 0; id < TOTAL_CARDS; id++) {
    if (!card(id).bonus) new Image().src = cardUrl(id);
  }
}

export function backSvg(): string {
  return `<svg viewBox="0 0 60 96" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">` +
    `<rect width="60" height="96" rx="5" fill="#c8141e"/>` +
    `<rect x="4" y="4" width="52" height="88" rx="3" fill="none" stroke="#e8505a" stroke-width="1"/>` +
    `<path d="M30 30 L42 48 L30 66 L18 48 Z" fill="none" stroke="#e8505a" stroke-width="1"/>` +
    `<rect x="0.5" y="0.5" width="59" height="95" rx="4.6" fill="none" stroke="#7a0d12" stroke-width="1"/></svg>`;
}

export function dummySvg(): string {
  return `<svg viewBox="0 0 60 96" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">` +
    `<rect width="60" height="96" rx="5" fill="#5c6670"/>` +
    `<rect x="4" y="4" width="52" height="88" rx="3" fill="none" stroke="#aab3bb" stroke-width="1" stroke-dasharray="3 2"/>` +
    `<text x="30" y="46" font-size="10" text-anchor="middle" fill="#fff" font-weight="700" font-family="'Malgun Gothic',sans-serif">빈 패</text>` +
    `<text x="30" y="60" font-size="6.5" text-anchor="middle" fill="#dfe4e8" font-family="'Malgun Gothic',sans-serif">뒤집기만</text></svg>`;
}
