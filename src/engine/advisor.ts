// 플레이어용 수 추천.
// 실제 게임 상태(GameState)를 직접 받지 않고, 공개된 정보만 담은 PublicView를 받는다.
// 상대 손패와 더미는 모르는 카드를 무작위로 나눠 채운 가상 배치를 여러 개 만들어 평균을 낸다.
// 그래서 상대 패나 더미 순서를 들여다볼 방법이 구조적으로 없다.
import { card, isBonus, monthOf, TOTAL_CARDS } from './cards';
import { chooseAction, decideGoStop, decideGukjin, evaluate, potential } from './ai';
import {
  Action, canBomb, canShake, currentScore, Frame, GameEvent, GameState, gukjinOptions, legalActions, PlayerIndex, PlayerState, Rng, step,
} from './game';
import { comboProgress } from './scoring';

type PublicPlayer = Omit<PlayerState, 'hand'>;

/** 한 플레이어 시점에서 보이는 정보 */
export interface PublicView {
  me: PlayerIndex;
  myHand: number[];
  /** 상대 손패 장수 */
  oppHandCount: number;
  /** 상대가 흔들기로 보여 줬고 아직 손에 있는 패 */
  oppRevealed: number[];
  deckCount: number;
  floor: number[];
  players: [PublicPlayer, PublicPlayer];
  current: PlayerIndex;
  dealer: PlayerIndex;
  phase: GameState['phase'];
  ppeokOwner: GameState['ppeokOwner'];
  ctx: GameState['ctx'];
  choice: GameState['choice'];
  nagariMultiplier: number;
}

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

export function publicView(s: GameState, me: PlayerIndex): PublicView {
  const opp = other(me);
  const strip = ({ hand: _hand, ...rest }: PlayerState): PublicPlayer => structuredClone(rest);
  // 흔들어 보여 준 패 중 이미 바닥·획득 패로 나온 것은 손에 없다
  const seen = new Set([...s.floor, ...s.players[0].captured, ...s.players[1].captured]);
  return {
    me,
    myHand: [...s.players[me].hand],
    oppHandCount: s.players[opp].hand.length,
    oppRevealed: s.players[opp].revealed.filter((id) => !seen.has(id)),
    deckCount: s.deck.length,
    floor: [...s.floor],
    players: [strip(s.players[0]), strip(s.players[1])],
    current: s.current,
    dealer: s.dealer,
    phase: s.phase,
    ppeokOwner: { ...s.ppeokOwner },
    ctx: structuredClone(s.ctx),
    choice: structuredClone(s.choice),
    nagariMultiplier: s.nagariMultiplier,
  };
}

/** 내 시점에서 위치를 모르는 카드 (상대 손패 또는 더미) */
export function unknownCards(v: PublicView): number[] {
  const known = new Set([...v.myHand, ...v.floor, ...v.players[0].captured, ...v.players[1].captured, ...v.oppRevealed]);
  const out: number[] = [];
  for (let i = 0; i < TOTAL_CARDS; i++) if (!known.has(i)) out.push(i);
  return out;
}

function shuffled<T>(a: T[], rng: Rng): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** 모르는 카드를 상대 손패와 더미에 무작위로 나눈 가상 상태 */
function determinize(v: PublicView, rng: Rng): GameState {
  const pool = shuffled(unknownCards(v), rng);
  const oppHand = [...v.oppRevealed, ...pool.splice(0, Math.max(0, v.oppHandCount - v.oppRevealed.length))];
  const deck = pool.slice(0, v.deckCount);
  const players = v.players.map((p, i) => ({ ...structuredClone(p), hand: i === v.me ? [...v.myHand] : oppHand })) as [PlayerState, PlayerState];
  return {
    deck, floor: [...v.floor], players, current: v.current, dealer: v.dealer, phase: v.phase,
    ppeokOwner: { ...v.ppeokOwner }, ctx: structuredClone(v.ctx), choice: structuredClone(v.choice),
    nagariMultiplier: v.nagariMultiplier, result: null,
  };
}

/** 문자열로 만든 시드 난수. 같은 장면에서는 추천이 흔들리지 않게 한다 */
function seededRng(key: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let x = h >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const last = (f: Frame[]) => f[f.length - 1].state;

/** p의 차례 중 남은 결정(바닥 고르기·국진·고스톱)을 AI 방식으로 처리 */
function resolve(s: GameState, p: PlayerIndex, events: GameEvent[]): GameState {
  let cur = s;
  for (let guard = 0; guard < 6 && cur.phase !== 'end' && cur.current === p && cur.phase !== 'play'; guard++) {
    const frames = step(cur, chooseAction(cur));
    for (const f of frames) events.push(...f.events);
    cur = last(frames);
  }
  return cur;
}

/**
 * 상대의 응수. 상대도 더미를 모르므로 바닥과 맞춰 얻는 것만 보고 고른다.
 * (가상 배치의 더미를 보고 고르면 상대가 미래를 아는 셈이 되어 지나치게 비관적이 된다)
 */
function opponentReply(s: GameState): Action {
  const opp = s.current;
  const p = s.players[opp];
  const bonus = p.hand.find(isBonus);
  if (bonus !== undefined) return { type: 'play', card: bonus };
  if (p.hand.length === 0) return { type: 'dummy' };
  const mine = p.captured;
  const theirs = s.players[other(opp)].captured;
  const base = potential(mine, theirs);
  let best: Action = { type: 'play', card: p.hand[0] };
  let bestV = -Infinity;
  for (const c of p.hand) {
    const pile = s.floor.filter((id) => monthOf(id) === monthOf(c));
    let take: number[] = [];
    if (pile.length === 1 || pile.length === 3) take = [c, ...pile];
    else if (pile.length === 2) {
      const pick = pile.reduce((a, b) => (potential([...mine, c, a], theirs) >= potential([...mine, c, b], theirs) ? a : b));
      take = [c, pick];
    }
    const v = take.length ? potential([...mine, ...take], theirs) - base : -0.2 - potential([...theirs, c], mine) * 0.05;
    if (v > bestV) { bestV = v; best = { type: 'play', card: c, shake: canShake(s, c) }; }
  }
  return best;
}

/** 지금 결정해야 하는 단계에서 내가 고를 수 있는 행동 */
function candidateActions(s: GameState): Action[] {
  if (s.phase !== 'play') return legalActions(s);
  const p = s.players[s.current];
  const acts: Action[] = [];
  for (const c of p.hand) {
    acts.push({ type: 'play', card: c });
    if (canShake(s, c)) acts.push({ type: 'play', card: c, shake: true });
  }
  for (let m = 1; m <= 12; m++) if (canBomb(s, m)) acts.push({ type: 'bomb', month: m });
  if (p.dummies > 0) acts.push({ type: 'dummy' });
  return acts;
}

interface Stats {
  value: number;
  /** 사건별 발생 비율 */
  freq: Partial<Record<GameEvent['type'], number>>;
  /** 상대 응수 후 상대가 새로 완성한 족보 비율 */
  oppCombo: number;
  /** 내가 이번 수로 7점 이상에 닿은 비율 */
  reach: number;
}

function simulate(v: PublicView, action: Action, worlds: GameState[]): Stats {
  const me = v.me;
  const opp = other(me);
  let total = 0, oppCombo = 0, reach = 0;
  const freq: Stats['freq'] = {};
  for (const w of worlds) {
    const events: GameEvent[] = [];
    const frames = step(w, action);
    for (const f of frames) events.push(...f.events);
    let s = resolve(last(frames), me, events);
    if (events.some((e) => e.type === 'scoreReady' && e.player === me) || (s.result?.winner === me)) reach++;
    for (const t of new Set(events.filter((e) => 'player' in e ? e.player === me : true).map((e) => e.type))) {
      freq[t] = (freq[t] ?? 0) + 1;
    }
    // 내 차례가 끝났으면 상대의 응수 한 수까지 본다
    if (s.phase === 'play' && s.current === opp) {
      const oe: GameEvent[] = [];
      const of = step(s, opponentReply(s));
      for (const f of of) oe.push(...f.events);
      s = resolve(last(of), opp, oe);
      if (oe.some((e) => e.type === 'combo' && e.player === opp)) oppCombo++;
    }
    total += evaluate(s, me);
  }
  const n = worlds.length;
  for (const k of Object.keys(freq) as (keyof typeof freq)[]) freq[k]! /= n;
  // 흔들기는 이겼을 때 점수가 두 배라 한 수 앞만 봐서는 차이가 없다. 조금 가산한다
  const shakeBonus = action.type === 'play' && action.shake ? 1.5 : 0;
  return { value: total / n + shakeBonus, freq, oppCombo: oppCombo / n, reach: reach / n };
}

export interface Recommendation {
  action: Action;
  /** 1위부터 */
  rank: number;
  value: number;
  reason: string;
}

export interface Advice {
  phase: 'play' | 'chooseFloor';
  /** 좋은 순서대로 전부 (이유는 1위에만) */
  ranked: Recommendation[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 낸 패가 바닥과 맞을 때 확실히 얻는 패 */
function certainTake(v: PublicView, action: Action): number[] {
  if (action.type === 'bomb') return [...v.myHand.filter((c) => monthOf(c) === action.month), ...v.floor.filter((c) => monthOf(c) === action.month)];
  if (action.type !== 'play') return [];
  const pile = v.floor.filter((id) => monthOf(id) === monthOf(action.card));
  if (pile.length === 1 || pile.length === 3) return [action.card, ...pile];
  return [];
}

function describe(v: PublicView, action: Action, st: Stats, others: Stats[]): string {
  const me = v.me;
  const mine = v.players[me].captured;
  const theirs = v.players[other(me)].captured;
  const parts: string[] = [];

  if (action.type === 'play' && isBonus(action.card)) {
    const canSteal = theirs.some((id) => card(id).kind === 'pi' || (card(id).gukjin && v.players[other(me)].gukjinPi));
    return `보너스패: ${canSteal ? '상대 피 1장을 빼앗고 ' : ''}한 장을 더 받습니다`;
  }
  if (action.type === 'bomb') parts.push('폭탄으로 4장 획득 · 점수 ×2');
  if (action.type === 'play' && action.shake) parts.push('흔들기 (이기면 ×2)');

  const take = certainTake(v, action);
  if (take.length) {
    const before = comboProgress(mine, theirs).filter((c) => c.state === 'done').map((c) => c.key);
    const done = comboProgress([...mine, ...take], theirs).filter((c) => c.state === 'done' && !before.includes(c.key));
    for (const c of done) parts.push(`${c.label} 완성`);
    const threats = comboProgress(theirs, mine).filter((c) => c.state === 'likely' && c.key !== 'gwang');
    for (const t of threats) {
      const needed = { godori: [4, 12, 29], hongdan: [1, 5, 9], cheongdan: [21, 33, 37], chodan: [13, 17, 25], gwang: [] as number[] }[t.key];
      if (take.some((id) => needed.includes(id) && !t.cards.includes(id))) parts.push(`상대 ${t.label} 차단`);
    }
    if (!done.length && parts.length < 2) {
      // 낸 패도 함께 먹으므로 낸 패까지 포함해 요약한다
      const kinds = take.map((id) => card(id));
      const got: string[] = [];
      if (kinds.some((c) => c.kind === 'gwang')) got.push('광');
      if (kinds.some((c) => c.godori)) got.push('고도리 새');
      else if (kinds.some((c) => c.kind === 'yeol')) got.push('열끗');
      if (kinds.some((c) => c.kind === 'tti' && c.ribbon !== 'bi')) got.push(`${{ hong: '홍단', cheong: '청단', cho: '초단' }[kinds.find((c) => c.kind === 'tti' && c.ribbon !== 'bi')!.ribbon as 'hong']} 띠`);
      else if (kinds.some((c) => c.kind === 'tti')) got.push('띠');
      const pi = kinds.reduce((a, c) => a + (c.kind === 'pi' ? c.piValue : 0), 0);
      if (pi) got.push(`피 ${pi}장`);
      if (got.length) parts.push(`${got.join('·')} 획득`);
    }
  }
  const avg = (f: (s: Stats) => number) => (others.length ? others.reduce((a, s) => a + f(s), 0) / others.length : 0);
  if (st.reach >= 0.25) parts.push(`7점 도달 가능성 ${pct(st.reach)}`);
  for (const [t, label] of [['jjok', '쪽'], ['ttadak', '따닥'], ['ppeokTake', '뻑 먹기'], ['sseul', '쓸']] as const) {
    if ((st.freq[t] ?? 0) >= 0.2 && parts.length < 3) parts.push(`${label} 기회 ${pct(st.freq[t]!)}`);
  }
  const combo = st.freq.combo ?? 0;
  if (combo >= 0.2 && !parts.some((p) => p.endsWith('완성'))) parts.push(`족보 완성 가능성 ${pct(combo)}`);
  if (others.length && avg((s) => s.oppCombo) - st.oppCombo >= 0.15) parts.push('상대 족보 기회를 줄임');
  if (!take.length && action.type === 'play' && !action.shake && parts.length === 0) {
    parts.push((st.freq.ppeok ?? 0) < avg((s) => s.freq.ppeok ?? 0) ? '맞는 패가 없을 때 가장 안전하게 버리는 패' : '버려도 손해가 가장 적은 패');
  }
  if ((st.freq.ppeok ?? 0) >= 0.3) parts.push(`뻑 위험 ${pct(st.freq.ppeok!)}`);
  return parts.slice(0, 3).join(' · ') || '기대 점수가 가장 높은 수';
}

/** 지금 장면에서 둘 수의 추천. 내 차례(낼 패·바닥 고르기)가 아니면 null */
export function recommend(v: PublicView, samples = 32): Advice | null {
  if (v.current !== v.me || (v.phase !== 'play' && v.phase !== 'chooseFloor')) return null;
  const rng = seededRng(JSON.stringify([v.myHand, v.floor, v.players[0].captured, v.players[1].captured, v.deckCount, v.phase, v.choice]));
  // 모든 후보가 같은 가상 배치를 쓰게 해서 비교가 공정하도록 한다
  const unknown = unknownCards(v).length;
  const worlds = Array.from({ length: unknown > 0 ? samples : 1 }, () => determinize(v, rng));
  const acts = candidateActions(worlds[0]);
  const stats = acts.map((a) => simulate(v, a, worlds));
  const order = acts.map((_, i) => i).sort((a, b) => stats[b].value - stats[a].value);
  const ranked = order.map((i, r) => ({
    action: acts[i],
    rank: r + 1,
    value: stats[i].value,
    reason: r === 0 ? describe(v, acts[i], stats[i], order.slice(1).map((j) => stats[j])) : '',
  }));
  return { phase: v.phase, ranked };
}

export interface GoStopAdvice {
  go: boolean;
  reason: string;
}

/** 고/스톱 조언. 상대 AI와 같은 기준을 쓰고 이유를 붙인다 */
export function adviseGoStop(v: PublicView): GoStopAdvice {
  const s = determinize(v, seededRng('gostop'));
  const me = v.me;
  const p = v.players[me];
  const opp = currentScore(s, other(me));
  const mine = currentScore(s, me);
  const go = decideGoStop(s);
  let reason: string;
  if (v.deckCount <= 4) reason = '남은 더미가 적어 더 먹기 어렵습니다';
  else if (opp >= 5) reason = `상대가 ${opp}점이라 고박 위험이 큽니다`;
  else if (p.goCount >= 2 && opp >= 3) reason = `이미 ${p.goCount}고이고 상대가 ${opp}점입니다`;
  else if (mine >= 15) reason = '점수가 충분히 높습니다';
  else if (p.goCount >= 3) reason = '고를 충분히 불렀습니다';
  else reason = `상대가 ${opp}점이라 더 노려볼 만합니다`;
  return { go, reason };
}

/** 국진(9월 술잔) 쌍피 전환 조언 */
export function adviseGukjin(v: PublicView): { toPi: boolean; reason: string } {
  const s = determinize(v, seededRng('gukjin'));
  const toPi = decideGukjin(s);
  const o = gukjinOptions(s, v.me);
  const reason = o.pi !== o.yeol
    ? `${toPi ? '쌍피' : '열끗'}로 두면 ${Math.max(o.pi, o.yeol)}점으로 더 높습니다`
    : toPi ? '점수는 같지만 정산 금액이 더 큽니다' : '점수와 정산 금액이 같거나 열끗이 유리합니다';
  return { toPi, reason };
}

/** 표시용: 행동 이름 */
export function actionLabel(a: Action): string {
  if (a.type === 'play') return `${card(a.card).name}${card(a.card).month ? `(${card(a.card).month}월)` : ''}${a.shake ? ' 흔들기' : ''}`;
  if (a.type === 'bomb') return `${a.month}월 폭탄`;
  if (a.type === 'dummy') return '빈 패';
  if (a.type === 'choose') return card(a.card).name;
  return '';
}
