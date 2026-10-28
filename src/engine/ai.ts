import { card, monthOf, TOTAL_CARDS } from './cards';
import { Action, canShake, currentScore, Frame, GameState, gukjinOptions, legalActions, PlayerIndex, settle, step, WIN_SCORE } from './game';
import { score } from './scoring';

const GODORI = [4, 12, 29]; // 2·4·8월 새
const DANS: Record<string, number[]> = { hong: [1, 5, 9], cheong: [21, 33, 37], cho: [13, 17, 25] };

/** 획득 패의 잠재 가치. 점수 + 족보·장수 진행도 */
export function potential(mine: number[], theirs: number[]): number {
  const d = score(mine);
  let v = d.total * 3;
  if (d.gwangCount < 3) {
    for (const id of mine) if (card(id).kind === 'gwang') v += card(id).biGwang ? 1 : 1.6;
  }
  const blocked = (set: number[]) => set.some((id) => theirs.includes(id));
  const have = (set: number[]) => set.filter((id) => mine.includes(id)).length;
  const prog = (set: number[], weights: number[]) => {
    const k = have(set);
    if (k >= 3) return 0;
    return blocked(set) ? k * 0.3 : weights[k];
  };
  v += prog(GODORI, [0, 1.2, 3.5]);
  for (const set of Object.values(DANS)) v += prog(set, [0, 1, 3]);
  // 장수 진행 가치는 기준 장수에 닿은 뒤에도 유지한다 (사라지면 10장째 피가 오히려 손해로 계산된다)
  v += Math.min(d.yeolCount, 5) * 0.6;
  v += Math.min(d.ttiCount, 5) * 0.55;
  v += Math.min(d.piCount, 10) * 0.6 + (d.piCount >= 7 ? 0.8 : 0);
  return v;
}

export function evaluate(s: GameState, me: PlayerIndex): number {
  if (s.phase === 'end' && s.result) {
    if (s.result.winner === me) return 1000 + s.result.final;
    if (s.result.winner !== null) return -1000 - s.result.final;
    return -5;
  }
  const opp: PlayerIndex = me === 0 ? 1 : 0;
  const mine = s.players[me].captured;
  const theirs = s.players[opp].captured;
  let v = potential(mine, theirs) - potential(theirs, mine) * 0.9;
  if ((s.phase === 'goStop' || s.phase === 'gukjin') && s.current === me) v += 50;
  return v;
}

/** 바닥에 남긴 패를 상대가 가져갈 위험 */
function exposure(s: GameState, me: PlayerIndex, unseenCount: number): number {
  const opp: PlayerIndex = me === 0 ? 1 : 0;
  const oppHand = s.players[opp].hand.length;
  if (oppHand === 0 || unseenCount === 0) return 0;
  const known = new Set([...s.floor, ...s.players[me].hand, ...s.players[0].captured, ...s.players[1].captured]);
  let risk = 0;
  const months = new Set(s.floor.map(monthOf));
  for (const m of months) {
    let unseenOfMonth = 0;
    for (let k = 0; k < 4; k++) if (!known.has((m - 1) * 4 + k)) unseenOfMonth++;
    if (unseenOfMonth === 0) continue;
    const prob = Math.min(1, (unseenOfMonth * oppHand) / unseenCount);
    const pile = s.floor.filter((id) => monthOf(id) === m);
    const theirs = s.players[opp].captured;
    const gain = potential([...theirs, ...pile], s.players[me].captured) - potential(theirs, s.players[me].captured);
    risk += prob * gain * 1.0;
  }
  return risk;
}

function lastState(frames: Frame[]): GameState {
  return frames[frames.length - 1].state;
}

/** 시뮬레이션 안에서 결정이 필요한 단계를 탐욕적으로 처리 */
function resolveGreedy(s: GameState, me: PlayerIndex): GameState {
  let cur = s;
  for (let guard = 0; guard < 4 && cur.current === me; guard++) {
    if (cur.phase === 'chooseFloor') cur = lastState(step(cur, { type: 'choose', card: bestFloorChoice(cur) }));
    else break;
  }
  return cur;
}

export function bestFloorChoice(s: GameState): number {
  const me = s.current;
  const opp: PlayerIndex = me === 0 ? 1 : 0;
  const mine = s.players[me].captured;
  const theirs = s.players[opp].captured;
  let best = s.choice!.options[0];
  let bestV = -Infinity;
  for (const c of s.choice!.options) {
    const v = potential([...mine, c], theirs);
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

function unseenCards(s: GameState, me: PlayerIndex): number[] {
  const known = new Set([...s.floor, ...s.players[me].hand, ...s.players[0].captured, ...s.players[1].captured]);
  const out: number[] = [];
  for (let i = 0; i < TOTAL_CARDS; i++) if (!known.has(i)) out.push(i);
  return out;
}

function scorePlayAction(s: GameState, action: Action, me: PlayerIndex): number {
  const unseen = unseenCards(s, me);
  if (unseen.length === 0 || s.deck.length === 0) {
    const r = resolveGreedy(lastState(step(s, action)), me);
    return evaluate(r, me) - exposure(r, me, 1);
  }
  let total = 0;
  for (const u of unseen) {
    // 더미 맨 위가 u라고 가정하고 시뮬레이션 (AI는 더미 순서를 모른다)
    const sim: GameState = { ...s, deck: [u, ...unseen.filter((x) => x !== u)].slice(0, s.deck.length) };
    const r = resolveGreedy(lastState(step(sim, action)), me);
    total += evaluate(r, me) - exposure(r, me, unseen.length - 1);
  }
  return total / unseen.length;
}

export function decideGoStop(s: GameState): boolean {
  const me = s.current;
  const opp: PlayerIndex = me === 0 ? 1 : 0;
  const p = s.players[me];
  const oppScore = currentScore(s, opp);
  const myScore = currentScore(s, me);
  if (s.deck.length <= 4) return false;
  if (oppScore >= 5) return false;
  if (p.goCount >= 2 && oppScore >= 3) return false;
  if (myScore >= WIN_SCORE + 8) return false;
  if (p.goCount >= 3) return false;
  return true;
}

/** 국진을 쌍피로 바꿀지: 지금 스톱했을 때 받을 금액(점수)이 큰 쪽, 같으면 점수가 큰 쪽 */
export function decideGukjin(s: GameState): boolean {
  const me = s.current;
  const o = gukjinOptions(s, me);
  const value = (toPi: boolean) => {
    const t = structuredClone(s);
    t.players[me].gukjinPi = toPi;
    return (toPi ? o.pi : o.yeol) >= WIN_SCORE ? settle(t, me).final : 0;
  };
  const yeol = value(false), pi = value(true);
  if (pi !== yeol) return pi > yeol;
  return o.pi > o.yeol;
}

export function chooseAction(s: GameState): Action {
  const me = s.current;
  if (s.phase === 'chooseFloor') return { type: 'choose', card: bestFloorChoice(s) };
  if (s.phase === 'gukjin') return { type: 'gukjin', toPi: decideGukjin(s) };
  if (s.phase === 'goStop') return { type: 'goStop', go: decideGoStop(s) };
  const acts = legalActions(s);
  const bonus = acts.find((a) => a.type === 'play' && card(a.card).bonus);
  if (bonus) return bonus;
  let best = acts[0];
  let bestV = -Infinity;
  for (const a of acts) {
    const v = scorePlayAction(s, a, me);
    if (v > bestV) { bestV = v; best = a; }
  }
  if (best.type === 'play') best = { ...best, shake: canShake(s, best.card) };
  return best;
}
