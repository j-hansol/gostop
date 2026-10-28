import { card, DAN_SETS } from './cards';

export type Combo = 'godori' | 'hongdan' | 'cheongdan' | 'chodan' | 'gwang3' | 'bigwang3' | 'gwang4' | 'gwang5';

export const COMBO_LABEL: Record<Combo, string> = {
  godori: '고도리',
  hongdan: '홍단',
  cheongdan: '청단',
  chodan: '초단',
  gwang3: '3광',
  bigwang3: '비삼광',
  gwang4: '4광',
  gwang5: '5광',
};

export interface ScoreDetail {
  total: number;
  gwangPoints: number;
  yeolPoints: number;
  ttiPoints: number;
  piPoints: number;
  gwangCount: number;
  yeolCount: number;
  ttiCount: number;
  piCount: number;
  combos: Combo[];
  /** 국진을 쌍피로 계산했는지 */
  gukjinAsPi: boolean;
}

function scoreWith(ids: number[], gukjinAsPi: boolean): ScoreDetail {
  let gwangCount = 0, biGwang = false, yeolCount = 0, ttiCount = 0, piCount = 0, birds = 0;
  const ribbons = { hong: 0, cheong: 0, cho: 0 };
  for (const id of ids) {
    const c = card(id);
    if (c.kind === 'gwang') {
      gwangCount++;
      if (c.biGwang) biGwang = true;
    } else if (c.kind === 'yeol') {
      if (c.gukjin && gukjinAsPi) piCount += 2;
      else yeolCount++;
      if (c.godori) birds++;
    } else if (c.kind === 'tti') {
      ttiCount++;
      if (c.ribbon && c.ribbon !== 'bi') ribbons[c.ribbon]++;
    } else {
      piCount += c.piValue;
    }
  }
  const combos: Combo[] = [];
  let gwangPoints = 0;
  if (gwangCount === 5) { gwangPoints = 15; combos.push('gwang5'); }
  else if (gwangCount === 4) { gwangPoints = 4; combos.push('gwang4'); }
  else if (gwangCount === 3) {
    gwangPoints = biGwang ? 2 : 3;
    combos.push(biGwang ? 'bigwang3' : 'gwang3');
  }
  let yeolPoints = yeolCount >= 5 ? yeolCount - 4 : 0;
  if (birds === 3) { yeolPoints += 5; combos.push('godori'); }
  let ttiPoints = ttiCount >= 5 ? ttiCount - 4 : 0;
  for (const k of ['hong', 'cheong', 'cho'] as const) {
    if (ribbons[k] === 3) { ttiPoints += 3; combos.push(`${k}dan` as Combo); }
  }
  const piPoints = piCount >= 10 ? piCount - 9 : 0;
  return {
    total: gwangPoints + yeolPoints + ttiPoints + piPoints,
    gwangPoints, yeolPoints, ttiPoints, piPoints,
    gwangCount, yeolCount, ttiCount, piCount, combos, gukjinAsPi,
  };
}

/** 국진을 열끗/쌍피 중 점수가 높은 쪽으로 자동 선택한다. */
export function score(ids: number[]): ScoreDetail {
  const asYeol = scoreWith(ids, false);
  if (!ids.some((id) => card(id).gukjin)) return asYeol;
  const asPi = scoreWith(ids, true);
  if (asPi.total !== asYeol.total) return asPi.total > asYeol.total ? asPi : asYeol;
  // 동점이면 피박을 피하기 쉬운 쌍피 쪽
  return asPi;
}

/** 피박 판정용: 국진을 피로 셀 수 있으면 센다. */
export function maxPiCount(ids: number[]): number {
  return Math.max(scoreWith(ids, false).piCount, scoreWith(ids, true).piCount);
}

export function danProgress(ids: number[], set: keyof typeof DAN_SETS): number {
  return ids.filter((id) => {
    const c = card(id);
    return c.kind === 'tti' && c.ribbon === set;
  }).length;
}

export type ComboKey = 'godori' | 'hongdan' | 'cheongdan' | 'chodan' | 'gwang';

export interface ComboProgress {
  key: ComboKey;
  label: string;
  have: number;
  need: number;
  /** done: 달성, likely: 1장만 남았고 아직 가능, open: 진행 중 */
  state: 'done' | 'likely' | 'open';
  /** 이 족보에 쓰인 내 패 */
  cards: number[];
}

const SET_CARDS: [ComboKey, string, number[]][] = [
  ['godori', '고도리', [4, 12, 29]],
  ['hongdan', '홍단', [1, 5, 9]],
  ['cheongdan', '청단', [21, 33, 37]],
  ['chodan', '초단', [13, 17, 25]],
];
const GWANG_CARDS = [0, 8, 28, 40, 44];

/** 족보별 진행 상황. 상대가 한 장이라도 가져가 막힌 족보는 빠진다. */
export function comboProgress(mine: number[], theirs: number[]): ComboProgress[] {
  const out: ComboProgress[] = [];
  for (const [key, label, set] of SET_CARDS) {
    const have = set.filter((id) => mine.includes(id));
    if (have.length === 0) continue;
    if (have.length === 3) {
      out.push({ key, label, have: 3, need: 3, state: 'done', cards: have });
      continue;
    }
    if (set.some((id) => theirs.includes(id))) continue;
    out.push({ key, label, have: have.length, need: 3, state: have.length === 2 ? 'likely' : 'open', cards: have });
  }
  const gw = GWANG_CARDS.filter((id) => mine.includes(id));
  const left = GWANG_CARDS.length - gw.length - GWANG_CARDS.filter((id) => theirs.includes(id)).length;
  if (gw.length >= 3) out.push({ key: 'gwang', label: `${gw.length}광`, have: gw.length, need: 3, state: 'done', cards: gw });
  else if (gw.length > 0 && gw.length + left >= 3) {
    out.push({ key: 'gwang', label: '광', have: gw.length, need: 3, state: gw.length === 2 ? 'likely' : 'open', cards: gw });
  }
  return out;
}
