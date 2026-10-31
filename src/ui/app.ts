import { card, isBonus, monthOf } from '../engine/cards';
import { chooseAction } from '../engine/ai';
import {
  Action, canBomb, canShake, currentScore, Frame, GameEvent, GameState, goAdjusted, GUKJIN, gukjinOptions, Mission, missionDone, missionLabel, newRound, PIBAK_LIMIT, PlayerIndex, playerScore, RoundResult, step, WIN_SCORE,
} from '../engine/game';
import { COMBO_LABEL, comboProgress, maxPiCount } from '../engine/scoring';
import {
  applyResult, FIRST_PPEOK_POINTS, FORFEIT_POINTS, loadProfile, nagariMultiplier, newProfile, payBonus, pointRate, Profile, saveProfile, Settlement,
} from '../engine/economy';
import { backSvg, cardSvg, dummySvg, preloadCards } from './cardArt';
import { actionLabel, Advice, adviseGoStop, adviseGukjin, publicView, recommend } from '../engine/advisor';
import { isMuted, setMuted, sfx, unlockAudio } from './sound';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const MOVE_MS = 380;

type Face = 'up' | 'down' | 'dummy';

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

class Cancelled extends Error {}

/** 수 추천 켜기/끄기 (기본 켜짐) */
let adviceOn = storage?.getItem('gostop-advice') !== 'off';
function setAdviceOn(v: boolean) {
  adviceOn = v;
  try {
    storage?.setItem('gostop-advice', v ? 'on' : 'off');
  } catch {
    /* 무시 */
  }
}
const sameAction = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);

const narrowQuery = window.matchMedia('(max-width: 720px)');

/** 획득 패 종류별 [최대 폭, 기본 간격] (카드 폭 단위) */
const CAP_FIT: Record<'gwang' | 'yeol' | 'tti' | 'pi', [number, number]> = {
  gwang: [2.6, 0.42],
  yeol: [3.2, 0.36],
  tti: [3.2, 0.36],
  pi: [4.8, 0.3],
};

/** 더미(0,0)를 둘러싼 바닥 칸 좌표. 넓은 화면 7×3, 좁은 화면 5×5 */
function slotGrid(): [number, number][] {
  const [cols, rows] = narrowQuery.matches ? [2, 2] : [3, 1];
  const out: [number, number][] = [];
  for (let c = -cols; c <= cols; c++) for (let r = -rows; r <= rows; r++) if (c || r) out.push([c, r]);
  return out;
}

export class App {
  private profile: Profile;
  private state: GameState | null = null;
  private busy = false;
  private gen = 0;
  private els = new Map<string, HTMLElement>();
  private faces = new Map<string, Face>();
  private floorSlots = new Map<number, [number, number]>();
  /** 마지막으로 계산한 추천 (상태 객체가 같을 때만 재사용) */
  private advice: { state: GameState; adv: Advice | null } | null = null;
  private adviceTimer = 0;
  /** 이번 판의 미션 (패에 표식을 붙일 때 쓴다) */
  private mission: Mission | null = null;
  private missionHtml = '';

  constructor() {
    let p = loadProfile(storage);
    if (!p || p.playerMoney <= 0) p = newProfile();
    this.profile = p;
    preloadCards();
    this.bindStatic();
    this.renderMeta();
    this.renderInfo();
    void this.boot();
  }

  // ───────────────────────── 시작 · 저장 ─────────────────────────

  private async boot() {
    let forfeit: Settlement | null = null;
    if (this.profile.inProgress) {
      const r = applyResult(this.profile, 1, FORFEIT_POINTS);
      forfeit = r.settlement;
      this.profile = r.profile;
      if (forfeit.playerBankrupt) this.profile = newProfile();
      saveProfile(storage, this.profile);
      this.renderMeta();
      this.renderInfo();
    }
    const p = this.profile;
    const body =
      `<p style="text-align:center">AI와 1:1로 즐기는 고스톱</p>` +
      `<table class="breakdown">` +
      `<tr><td>레벨</td><td>Lv.${p.level} (점당 ${won(pointRate(p.level))})</td></tr>` +
      `<tr><td>내 보유금</td><td>${won(p.playerMoney)}</td></tr>` +
      `<tr><td>상대</td><td>${p.ai.name} · ${won(p.ai.money)}</td></tr>` +
      `<tr><td>전적</td><td>${p.stats.wins}승 ${p.stats.losses}패 ${p.stats.draws}무</td></tr>` +
      (p.nagariStreak ? `<tr><td>나가리 배수</td><td>×${nagariMultiplier(p.nagariStreak)}</td></tr>` : '') +
      `</table>` +
      (forfeit
        ? `<div class="callout red">지난 판을 끝내지 않고 종료해 <b>기권패</b>로 처리했습니다. (${FORFEIT_POINTS}점, ${won(forfeit.paid)} 지급)` +
          (forfeit.playerBankrupt ? '<br>보유금이 바닥나 처음부터 다시 시작합니다.' : '') + `</div>`
        : '');
    await this.dialog('맞고', body, [{ label: '게임 시작', value: 'start' }]);
    unlockAudio();
    void this.startRound();
  }

  private save() {
    saveProfile(storage, this.profile);
  }

  private bindStatic() {
    $('btn-sound').addEventListener('click', () => {
      unlockAudio();
      setMuted(!isMuted());
      this.renderSoundBtn();
    });
    this.renderSoundBtn();
    $('btn-rules').addEventListener('click', () => void this.showRules());
    $('btn-advice').addEventListener('click', () => {
      setAdviceOn(!adviceOn);
      this.renderAdviceBtn();
      if (this.state) this.updateAdvice(this.state);
    });
    this.renderAdviceBtn();
    $('btn-reset').addEventListener('click', () => void this.confirmReset());
    // 블로그 팝업 안에서 실행될 때만 닫기 버튼을 보인다
    if ((window as { __GOSTOP_EMBED?: boolean }).__GOSTOP_EMBED) {
      $('btn-close').classList.remove('hidden');
      $('btn-close').addEventListener('click', () => this.requestClose());
    }
    for (const id of ['mission-side', 'mission-top']) $(id).addEventListener('click', () => void this.showMission());
    $('hand-0').addEventListener('click', (e) => this.onHandClick(e));
    $('floor').addEventListener('click', (e) => this.onFloorClick(e));
    document.addEventListener('pointerdown', () => unlockAudio(), { once: true });
    // 게임 영역 안에서는 끌어 놓기와 글자 선택을 막는다 (CSS user-select가 안 먹는 브라우저 대비)
    const app = $('app');
    app.addEventListener('dragstart', (e) => e.preventDefault());
    app.addEventListener('selectstart', (e) => e.preventDefault());
  }

  private renderAdviceBtn() {
    $('btn-advice').classList.toggle('on', adviceOn);
    $('btn-advice').title = adviceOn ? '수 추천 끄기' : '수 추천 켜기';
  }

  /** 내 차례면 추천을 계산해 패에 표시한다. 계산은 화면을 먼저 그린 뒤에 한다 */
  private updateAdvice(s: GameState) {
    window.clearTimeout(this.adviceTimer);
    const show = adviceOn && !this.busy && s.current === 0 && (s.phase === 'play' || s.phase === 'chooseFloor');
    if (!show) {
      this.paintAdvice(null);
      return;
    }
    if (this.advice?.state === s) {
      this.paintAdvice(this.advice.adv);
      return;
    }
    this.paintAdvice(null);
    this.adviceTimer = window.setTimeout(() => {
      if (this.state !== s || this.busy) return;
      // 실제 상태가 아니라 공개 정보만 넘긴다
      this.advice = { state: s, adv: recommend(publicView(s, 0)) };
      this.paintAdvice(this.advice.adv);
    }, 60);
  }

  private paintAdvice(adv: Advice | null) {
    for (const el of this.els.values()) delete el.dataset.rec;
    const hint = $('hint');
    hint.querySelector('.advice')?.remove();
    if (!adv) return;
    const s = this.state!;
    const marked = new Set<string>();
    for (const r of adv.ranked.slice(0, 3)) {
      const a = r.action;
      let keys: string[] = [];
      if (a.type === 'play' || a.type === 'choose') keys = [`c${a.card}`];
      else if (a.type === 'bomb') keys = s.players[0].hand.filter((c) => monthOf(c) === a.month).map((c) => `c${c}`);
      else if (a.type === 'dummy') keys = ['d0-0'];
      // 같은 카드의 흔들기/그냥 내기처럼 겹치면 높은 순위만 표시
      keys = keys.filter((k) => !marked.has(k));
      for (const k of keys) {
        marked.add(k);
        const el = this.els.get(k);
        if (el) el.dataset.rec = String(r.rank);
      }
    }
    const best = adv.ranked[0];
    const line = document.createElement('div');
    line.className = 'advice';
    line.innerHTML = `💡 <b>${actionLabel(best.action)}</b> · ${best.reason}`;
    hint.append(line);
  }

  /** 대화상자에 붙일 추천 한 줄. options 중 추천 순위가 가장 높은 것을 고른다 */
  private adviceLine(options: { action: Action; label: string }[]): string {
    if (!adviceOn || !this.state) return '';
    const adv = this.advice?.state === this.state ? this.advice.adv : recommend(publicView(this.state, 0));
    if (!adv) return '';
    const rankOf = (a: Action) => adv.ranked.findIndex((r) => sameAction(r.action, a));
    const best = options.filter((o) => rankOf(o.action) >= 0).sort((x, y) => rankOf(x.action) - rankOf(y.action))[0];
    return best ? `<p class="advice-line">💡 추천: <b>${best.label}</b></p>` : '';
  }

  private renderSoundBtn() {
    $('btn-sound').innerHTML = `${isMuted() ? '🔇' : '🔊'}<span class="lbl"> 소리</span>`;
  }

  private requestClose() {
    // 대화상자가 열려 있어도 확실히 물을 수 있도록 브라우저 기본 확인 창을 쓴다
    if (this.profile.inProgress &&
      !window.confirm(`진행 중인 판이 있습니다.
지금 닫으면 이번 판은 기권패(${FORFEIT_POINTS}점)로 처리됩니다. 닫을까요?`)) return;
    window.parent.postMessage({ type: 'gostop-close' }, '*');
  }

  private async confirmReset() {
    if (!$('modal').classList.contains('hidden')) return;
    const ok = await this.dialog(
      '처음부터',
      '<p>레벨, 보유금, 전적을 모두 초기화하고 새 게임을 시작할까요?</p>',
      [{ label: '초기화', value: 'yes', cls: 'red' }, { label: '취소', value: 'no', cls: 'gray' }],
    );
    if (ok !== 'yes') return;
    this.profile = newProfile();
    this.save();
    void this.startRound();
  }

  // ───────────────────────── 게임 진행 ─────────────────────────

  private async startRound() {
    const myGen = ++this.gen;
    this.busy = true;
    this.profile.inProgress = true;
    this.save();
    this.floorSlots.clear();
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    this.faces.clear();
    $('fx').replaceChildren();
    this.renderMeta();
    const frames = newRound({ dealer: this.profile.dealer, nagariMultiplier: nagariMultiplier(this.profile.nagariStreak) });
    this.mission = frames[0].state.mission;
    try {
      await this.playFrames(frames, myGen);
      if (this.mission && this.state!.phase !== 'end') {
        sfx.special();
        this.banner(`미션 ${missionLabel(this.mission)}`, 'mid', this.mission.cards, 'small mission-banner', '모두 가져가서 이기면 최종 점수에 적용');
        await this.wait(1700, myGen);
      }
      const dealer = this.state!.dealer;
      this.banner(dealer === 0 ? '내가 선!' : '상대가 선', dealer === 0 ? 'me' : 'ai', undefined, 'small');
      await this.wait(700, myGen);
      await this.advance(myGen);
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }

  private async wait(ms: number, myGen: number) {
    await delay(ms);
    if (myGen !== this.gen) throw new Cancelled();
  }

  private async apply(action: Action, myGen: number) {
    const frames = step(this.state!, action);
    await this.playFrames(frames, myGen);
  }

  /** 다음 입력이 필요할 때까지 진행 (AI 차례는 자동 처리) */
  private async advance(myGen: number) {
    for (;;) {
      const s = this.state!;
      if (s.phase === 'end') {
        await this.endRound(myGen);
        return;
      }
      if (s.current === 1) {
        this.busy = true;
        this.render(s);
        await this.wait(s.phase === 'play' ? 550 : 400, myGen);
        await this.apply(chooseAction(s), myGen);
        continue;
      }
      // 내 차례
      if (s.phase === 'gukjin') {
        const o = gukjinOptions(s, 0);
        const res = await this.dialog(
          '국진 전환',
          `<div class="gukjin-pick">${cardSvg(GUKJIN)}</div>` +
            `<p style="text-align:center">9월 술잔(국진)을 <b>쌍피</b>로 옮길까요?<br>` +
            `열끗으로 두면 <b>${o.yeol}점</b>, 쌍피로 옮기면 <b>${o.pi}점</b>입니다.<br>` +
            `<small>쌍피로 옮기면 이번 판이 끝날 때까지 되돌릴 수 없습니다.</small></p>` +
            (adviceOn ? (() => { const g = adviseGukjin(publicView(s, 0)); return `<p class="advice-line">💡 추천: <b>${g.toPi ? '쌍피로 전환' : '열끗 유지'}</b> · ${g.reason}</p>`; })() : ''),
          [{ label: `쌍피로 전환 (${o.pi}점)`, value: 'pi', cls: 'red' }, { label: `열끗 유지 (${o.yeol}점)`, value: 'yeol' }],
        );
        if (myGen !== this.gen) return;
        await this.apply({ type: 'gukjin', toPi: res === 'pi' }, myGen);
        continue;
      }
      if (s.phase === 'goStop') {
        const sc = currentScore(s, 0);
        const p = s.players[0];
        const next = goAdjusted(sc, p.goCount + 1);
        const res = await this.dialog(
          `${sc}점 달성!`,
          `<div class="big">${sc}점</div>` +
            `<p style="text-align:center">고를 하면 계속 진행합니다. 상대가 먼저 나면 <b>고박</b>(×2)을 씁니다.<br>` +
            `${p.goCount + 1}고 시 현재 점수 기준 <b>${next.value}점</b></p>` +
            (s.mission && missionDone(s.mission, p.captured) ? `<div class="callout">미션 완료: 지금 이기면 최종 점수 <b>${missionLabel(s.mission)}</b></div>` : '') +
            (adviceOn ? (() => { const g = adviseGoStop(publicView(s, 0)); return `<p class="advice-line">💡 추천: <b>${g.go ? '고' : '스톱'}</b> · ${g.reason}</p>`; })() : ''),
          [{ label: `${p.goCount + 1}고!`, value: 'go', cls: 'red' }, { label: '스톱', value: 'stop' }],
        );
        if (myGen !== this.gen) return;
        await this.apply({ type: 'goStop', go: res === 'go' }, myGen);
        continue;
      }
      this.busy = false;
      this.render(s);
      return;
    }
  }

  private async humanAct(action: Action) {
    const myGen = this.gen;
    this.busy = true;
    this.render(this.state!);
    try {
      await this.apply(action, myGen);
      await this.advance(myGen);
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }

  private async onHandClick(e: Event) {
    const s = this.state;
    if (!s || this.busy || s.current !== 0 || s.phase !== 'play') return;
    const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!el) return;
    const key = el.dataset.key!;
    if (key.startsWith('d')) {
      void this.humanAct({ type: 'dummy' });
      return;
    }
    const id = Number(key.slice(1));
    if (!s.players[0].hand.includes(id)) return;
    sfx.click();
    if (isBonus(id)) {
      void this.humanAct({ type: 'play', card: id });
      return;
    }
    const m = monthOf(id);
    const same = s.players[0].hand.filter((c) => monthOf(c) === m);
    if (canBomb(s, m)) {
      this.busy = true;
      const r = await this.dialog(
        '폭탄!',
        `<p>같은 월 ${same.length}장을 들고 있고 바닥에 ${4 - same.length}장이 있습니다. ${same.length}장을 한 번에 내면 4장을 모두 먹고 피 1장을 받으며, 점수가 ×2가 됩니다. 빈 패 ${same.length - 1}장을 받습니다.</p>` +
          this.cardRow(same) +
          this.adviceLine([{ action: { type: 'bomb', month: m }, label: '폭탄' }, { action: { type: 'play', card: id }, label: '한 장만 내기' }]),
        [{ label: '폭탄', value: 'bomb', cls: 'red' }, { label: '한 장만 내기', value: 'one' }, { label: '취소', value: 'cancel', cls: 'gray' }],
      );
      this.busy = false;
      if (r === 'bomb') void this.humanAct({ type: 'bomb', month: m });
      else if (r === 'one') void this.humanAct({ type: 'play', card: id });
      return;
    }
    if (canShake(s, id)) {
      this.busy = true;
      const r = await this.dialog(
        '흔들기',
        `<p>같은 월 3장을 들고 있습니다. 흔들면 상대에게 3장을 보여주고, 이기면 점수가 ×2가 됩니다.</p>` + this.cardRow(same) +
          this.adviceLine([{ action: { type: 'play', card: id, shake: true }, label: '흔들기' }, { action: { type: 'play', card: id }, label: '그냥 내기' }]),
        [{ label: '흔들기', value: 'shake', cls: 'red' }, { label: '그냥 내기', value: 'play' }, { label: '취소', value: 'cancel', cls: 'gray' }],
      );
      this.busy = false;
      if (r === 'shake') void this.humanAct({ type: 'play', card: id, shake: true });
      else if (r === 'play') void this.humanAct({ type: 'play', card: id });
      return;
    }
    void this.humanAct({ type: 'play', card: id });
  }

  private onFloorClick(e: Event) {
    const s = this.state;
    if (!s || this.busy || s.current !== 0 || s.phase !== 'chooseFloor' || !s.choice) return;
    const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!el) return;
    const id = Number(el.dataset.key!.slice(1));
    if (!s.choice.options.includes(id)) return;
    sfx.click();
    void this.humanAct({ type: 'choose', card: id });
  }

  private async endRound(myGen: number) {
    const s = this.state!;
    const r = s.result!;
    this.busy = true;
    this.render(s);
    const points = r.winner === null ? 0 : r.final;
    const { profile, settlement } = applyResult(this.profile, r.winner, points);
    this.profile = profile;
    this.save();
    if (r.winner === 0) sfx.win();
    else if (r.winner === 1) sfx.lose();
    await this.wait(900, myGen);
    this.renderMeta();
    this.renderInfo();
    await this.dialog(...this.resultDialog(r, settlement));
    if (myGen !== this.gen) return;
    if (settlement.playerBankrupt) {
      this.profile = newProfile();
      this.save();
      void this.startRound();
      return;
    }
    if (settlement.aiBankrupt && settlement.newAi) {
      sfx.levelUp();
      await this.dialog(
        `레벨 업! Lv.${settlement.levelAfter}`,
        `<p style="text-align:center"><b>${settlement.oldAi.name}</b>이(가) 파산해 퇴장했습니다.</p>` +
          `<div class="big">Lv.${settlement.levelBefore} → Lv.${settlement.levelAfter}</div>` +
          `<table class="breakdown">` +
          `<tr><td>새 상대</td><td>${settlement.newAi.name}</td></tr>` +
          `<tr><td>상대 보유금</td><td>${won(settlement.newAi.money)}</td></tr>` +
          `<tr><td>점당 금액</td><td>${won(pointRate(settlement.levelAfter))}</td></tr></table>`,
        [{ label: '새 상대와 대결', value: 'ok' }],
      );
      if (myGen !== this.gen) return;
    }
    void this.startRound();
  }

  private resultDialog(r: RoundResult, st: Settlement): [string, string, { label: string; value: string; cls?: string }[]] {
    const next = st.playerBankrupt ? [{ label: '처음부터 다시', value: 'ok', cls: 'red' }] : [{ label: '다음 판', value: 'ok' }];
    if (r.winner === null) {
      return [
        '나가리',
        `<p style="text-align:center">아무도 스톱하지 못해 무승부입니다.</p>` +
          `<div class="big">다음 판 ×${nagariMultiplier(this.profile.nagariStreak)}</div>`,
        next,
      ];
    }
    const meWin = r.winner === 0;
    const rows: string[] = [];
    if (r.special) {
      rows.push(`<tr><td>${r.special === 'chongtong' ? '총통' : '삼연뻑'}</td><td>${r.base}점</td></tr>`);
    } else if (r.detail) {
      const d = r.detail;
      const c = (list: string[]) => (list.length ? ` (${list.join(', ')})` : '');
      if (d.gwangPoints) rows.push(`<tr><td>광 ${d.gwangCount}장${c(d.combos.filter((x) => x.includes('gwang')).map((x) => COMBO_LABEL[x]))}</td><td>${d.gwangPoints}점</td></tr>`);
      if (d.yeolPoints) rows.push(`<tr><td>열끗 ${d.yeolCount}장${c(d.combos.includes('godori') ? ['고도리'] : [])}</td><td>${d.yeolPoints}점</td></tr>`);
      if (d.ttiPoints) rows.push(`<tr><td>띠 ${d.ttiCount}장${c(d.combos.filter((x) => x.endsWith('dan')).map((x) => COMBO_LABEL[x]))}</td><td>${d.ttiPoints}점</td></tr>`);
      if (d.piPoints) rows.push(`<tr><td>피 ${d.piCount}장</td><td>${d.piPoints}점</td></tr>`);
      rows.push(`<tr><td><b>기본 점수</b></td><td>${r.base}점</td></tr>`);
      if (r.goBonusText) rows.push(`<tr><td>${r.goBonusText}</td><td>${r.afterGo}점</td></tr>`);
    }
    for (const m of r.multipliers) rows.push(`<tr><td>${m.label}</td><td>×${m.factor}</td></tr>`);
    const mission = this.state?.mission;
    if (mission) {
      if (r.missionDone) rows.push(`<tr><td>미션 완료 ${missionLabel(mission)}</td><td>${r.beforeMission}점 → ${r.final}점</td></tr>`);
      else rows.push(`<tr><td>미션 ${missionLabel(mission)}</td><td>${r.special ? '특수 승리 미적용' : '미완료'}</td></tr>`);
    }
    rows.push(`<tr class="total"><td>최종 ${r.final}점 × ${won(st.rate)}</td><td>${won(st.amount)}</td></tr>`);
    let extra = '';
    if (st.paid < st.amount) extra += `<div class="callout">${meWin ? '상대' : '내'} 보유금이 부족해 <b>${won(st.paid)}</b>만 ${meWin ? '받았습니다' : '지급했습니다'}.</div>`;
    if (st.aiBankrupt) extra += `<div class="callout">💥 <b>${st.oldAi.name}</b> 파산! 레벨이 오릅니다.</div>`;
    if (st.playerBankrupt) extra += `<div class="callout red">보유금을 모두 잃었습니다. <b>게임 오버</b><br>레벨 1, ${won(50000)}으로 처음부터 다시 시작합니다.</div>`;
    const money = `<p style="text-align:center;margin-top:12px">내 보유금 <b>${won(this.profile.playerMoney)}</b> · 상대 <b>${won(st.aiBankrupt ? 0 : this.profile.ai.money)}</b></p>`;
    return [
      meWin ? '승리!' : '패배',
      `<p style="text-align:center">${meWin ? '내가' : '상대가'} ${r.special ? '특수 승리했습니다' : '스톱했습니다'}. ${meWin ? `<b>${won(st.paid)}</b> 획득` : `<b>${won(st.paid)}</b> 지급`}</p>` +
        `<table class="breakdown">${rows.join('')}</table>${extra}${money}`,
      next,
    ];
  }

  // ───────────────────────── 프레임 재생 · 연출 ─────────────────────────

  private async playFrames(frames: Frame[], myGen: number) {
    for (const f of frames) {
      if (myGen !== this.gen) throw new Cancelled();
      const moved = this.render(f.state, f.events.some((e) => e.type === 'deal'));
      this.state = f.state;
      const wait = await this.effects(f.events, f.state);
      const ms = Math.max(moved ? MOVE_MS + 60 : 60, wait);
      await this.wait(ms, myGen);
    }
  }

  /** 이벤트별 소리·배너. 추가로 기다려야 할 시간을 돌려준다. */
  private async effects(events: GameEvent[], s: GameState): Promise<number> {
    let wait = 0;
    const side = (p: PlayerIndex) => (p === 0 ? 'me' : 'ai');
    for (const e of events) {
      switch (e.type) {
        case 'deal': sfx.deal(); wait = Math.max(wait, 1100); break;
        case 'play': sfx.place(); break;
        case 'flip': sfx.flip(); break;
        case 'draw': sfx.flip(); break;
        case 'capture': setTimeout(() => sfx.capture(), 120); break;
        case 'bonus': sfx.special(); this.banner('보너스!', side(e.player), undefined, 'small'); wait = Math.max(wait, 600); break;
        case 'shake': sfx.special(); this.banner('흔들기!', side(e.player), e.cards); wait = Math.max(wait, 1300); break;
        case 'bomb': sfx.bomb(); this.screenShake(); this.banner('폭탄!', side(e.player), undefined, 'red'); wait = Math.max(wait, 1000); break;
        case 'jjok': sfx.special(); this.banner('쪽!', side(e.player)); wait = Math.max(wait, 900); break;
        case 'ttadak': sfx.special(); this.banner('따닥!', side(e.player)); wait = Math.max(wait, 900); break;
        case 'sseul': sfx.special(); this.banner('싹쓸이!', side(e.player)); wait = Math.max(wait, 900); break;
        case 'ppeok': {
          sfx.ppeok();
          this.screenShake();
          // 각자의 첫 턴에 뻑이 나면 상대에게서 7점에 해당하는 금액을 바로 받는다
          let sub: string | undefined;
          if (e.first) {
            const r = payBonus(this.profile, e.player, FIRST_PPEOK_POINTS);
            this.profile = r.profile;
            this.save();
            this.renderMeta();
            sub = `${e.player === 0 ? '상대에게서' : '나에게서'} ${won(r.paid)} (${FIRST_PPEOK_POINTS}점)`;
            this.toast(`${e.player === 0 ? '+' : '-'}${won(r.paid)}`, 0);
          }
          this.banner(e.streak >= 2 ? `${e.streak}연뻑!` : e.first ? '첫뻑!' : '뻑!', side(e.player), undefined, 'red', sub);
          wait = Math.max(wait, e.first ? 1600 : 1000);
          break;
        }
        case 'ppeokTake': sfx.special(); this.banner(e.self ? '자뻑!' : '뻑 먹기!', side(e.player)); wait = Math.max(wait, 900); break;
        case 'steal':
          sfx.steal();
          this.toast(`피 +${e.cards.reduce((a, c) => a + card(c).piValue, 0)}`, e.player);
          wait = Math.max(wait, 500);
          break;
        case 'combo': await delay(250); sfx.combo(); this.banner(COMBO_LABEL[e.combo], side(e.player), undefined, 'combo'); wait = Math.max(wait, 1200); break;
        case 'gukjin':
          if (e.toPi) { sfx.special(); this.banner('국진 → 쌍피', side(e.player), [GUKJIN], undefined, '9월 술잔을 쌍피로 전환'); wait = Math.max(wait, 1200); }
          break;
        case 'go': sfx.go(e.count); this.banner(`${e.count}고!`, side(e.player), undefined, 'red'); wait = Math.max(wait, 1100); break;
        case 'stop': sfx.stop(); this.banner('스톱!', side(e.player), undefined, undefined, e.auto ? '마지막 패 · 자동 스톱' : undefined); wait = Math.max(wait, 1200); break;
        case 'chongtong': sfx.combo(); this.banner('총통!', side(e.player), s.players[e.player].hand.filter((c) => monthOf(c) === e.month), 'combo'); wait = Math.max(wait, 1600); break;
        case 'samppeok': sfx.combo(); this.banner('삼연뻑!', side(e.player), undefined, 'combo'); wait = Math.max(wait, 1400); break;
        case 'nagari': sfx.nagari(); this.banner('나가리', 'mid', undefined, 'red'); wait = Math.max(wait, 1300); break;
        default: break;
      }
    }
    return wait;
  }

  private banner(text: string, side: 'me' | 'ai' | 'mid', cards?: number[], variant?: string, sub?: string) {
    const b = document.createElement('div');
    b.className = `banner ${side === 'mid' ? '' : side} ${variant ?? ''}`;
    if (variant?.includes('small')) b.style.fontSize = 'clamp(28px, 5vw, 56px)';
    b.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : '') + (cards?.length ? this.cardRow(cards) : '');
    $('fx').appendChild(b);
    setTimeout(() => b.remove(), cards?.length ? 1600 : 1000);
    if (cards?.length) b.style.animationDuration = '1.5s';
  }

  private toast(text: string, player: PlayerIndex) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    const target = $(`cap-${player}`).getBoundingClientRect();
    const app = $('app').getBoundingClientRect();
    t.style.left = `${target.right - app.left - 120}px`;
    t.style.top = `${target.top - app.top}px`;
    $('fx').appendChild(t);
    setTimeout(() => t.remove(), 1200);
  }

  private screenShake() {
    const a = $('app');
    a.classList.remove('shake-screen');
    void a.offsetWidth;
    a.classList.add('shake-screen');
  }

  private cardRow(ids: number[]): string {
    return `<div class="cards">${ids.map((id) => `<div class="card">${cardSvg(id)}</div>`).join('')}</div>`;
  }

  // ───────────────────────── 렌더링 (FLIP 애니메이션) ─────────────────────────

  private getEl(key: string): HTMLElement {
    let el = this.els.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'card';
      el.dataset.key = key;
      this.els.set(key, el);
    }
    return el;
  }

  private setFace(el: HTMLElement, key: string, face: Face) {
    if (this.faces.get(key) === face) return;
    this.faces.set(key, face);
    const id = Number(key.slice(1));
    // 뒷면에는 표식을 붙이지 않는다 (상대 손패와 더미가 드러나면 안 된다)
    const flag = face === 'up' && this.mission?.cards.includes(id) ? '<span class="m-flag">★</span>' : '';
    el.innerHTML = face === 'dummy' ? dummySvg() : face === 'down' ? backSvg() : cardSvg(id) + flag;
    el.title = face === 'up' ? card(id).name + (card(id).month ? ` (${card(id).month}월)` : '') : '';
  }

  /** 상태를 그리고, 움직인 카드가 있으면 true */
  private render(s: GameState, dealing = false): boolean {
    const before = new Map<string, DOMRect>();
    for (const [k, el] of this.els) if (el.isConnected) before.set(k, el.getBoundingClientRect());
    const deckRect = $('deck-slot').getBoundingClientRect();

    const want = new Map<string, Face>();
    const used = new Set<string>();
    const place = (key: string, face: Face): HTMLElement => {
      const el = this.getEl(key);
      want.set(key, face);
      used.add(key);
      return el;
    };

    // 손패
    for (const p of [0, 1] as const) {
      const ps = s.players[p];
      const hand = p === 0 ? [...ps.hand].sort((a, b) => monthOf(a) - monthOf(b) || a - b) : ps.hand;
      const nodes: HTMLElement[] = hand.map((id) => place(`c${id}`, p === 0 ? 'up' : 'down'));
      for (let i = 0; i < ps.dummies; i++) nodes.push(place(`d${p}-${i}`, 'dummy'));
      $(`hand-${p}`).replaceChildren(...nodes);
    }

    // 바닥
    const months = new Map<number, number[]>();
    for (const id of s.floor) {
      const m = monthOf(id);
      if (!months.has(m)) months.set(m, []);
      months.get(m)!.push(id);
    }
    // 바닥 패는 가운데 더미를 기준으로 무작위 방향의 빈 칸에 놓는다
    const grid = slotGrid();
    const valid = new Set(grid.map(([c, r]) => `${c},${r}`));
    for (const [m, pos] of this.floorSlots) {
      if (!months.has(m) || !valid.has(`${pos[0]},${pos[1]}`)) this.floorSlots.delete(m);
    }
    for (const m of months.keys()) {
      if (this.floorSlots.has(m)) continue;
      const taken = new Set([...this.floorSlots.values()].map(([c, r]) => `${c},${r}`));
      const free = grid.filter(([c, r]) => !taken.has(`${c},${r}`));
      const ring = Math.min(...free.map(([c, r]) => Math.max(Math.abs(c), Math.abs(r))));
      const near = free.filter(([c, r]) => Math.max(Math.abs(c), Math.abs(r)) === ring);
      this.floorSlots.set(m, near[Math.floor(Math.random() * near.length)] ?? [0, 0]);
    }
    const piles = [...this.floorSlots].map(([m, [c, r]]) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.setProperty('--c', String(c));
      slot.style.setProperty('--r', String(r));
      const pile = document.createElement('div');
      const choosing = s.phase === 'chooseFloor' && s.current === 0 && months.get(m)!.some((id) => s.choice?.options.includes(id));
      pile.className = 'pile' + (s.ppeokOwner[m] !== undefined ? ' ppeok' : '') + (choosing ? ' spread' : '');
      if (choosing) slot.classList.add('front');
      pile.append(...months.get(m)!.map((id) => place(`c${id}`, 'up')));
      slot.append(pile);
      return slot;
    });
    $('floor').replaceChildren($('deck'), ...piles);

    // 더미
    const top = s.deck[0];
    $('deck-slot').replaceChildren(...(top !== undefined ? [place(`c${top}`, 'down')] : []));
    $('deck-count').textContent = `${s.deck.length}장`;
    $('deck').classList.toggle('empty', s.deck.length === 0);

    // 먹은 패
    for (const p of [0, 1] as const) {
      const caps = s.players[p].captured;
      const d = playerScore(s.players[p]);
      const groups: Record<'gwang' | 'yeol' | 'tti' | 'pi', number[]> = { gwang: [], yeol: [], tti: [], pi: [] };
      for (const id of caps) {
        const c = card(id);
        if (c.gukjin && d.gukjinAsPi) groups.pi.unshift(id);
        else groups[c.kind].push(id);
      }
      groups.pi.sort((a, b) => card(a).piValue - card(b).piValue);
      // [이름, 장수, 점수가 나는 장수, 이 묶음의 점수]
      const labels = {
        gwang: ['광', d.gwangCount, 3, d.gwangPoints],
        yeol: ['열끗', d.yeolCount, 5, d.yeolPoints],
        tti: ['띠', d.ttiCount, 5, d.ttiPoints],
        pi: ['피', d.piCount, 10, d.piPoints],
      } as const;
      const nodes = (Object.keys(groups) as (keyof typeof groups)[]).map((k) => {
        const [name, count, goal, pts] = labels[k];
        const g = document.createElement('div');
        g.className = `cap-group ${k}${count === 0 ? ' empty' : ''}${pts > 0 ? ' scored' : count === goal - 1 ? ' near' : ''}`;
        const label = document.createElement('div');
        label.className = 'cap-label';
        label.innerHTML = `<span class="nm">${name}</span><b>${count}</b>${count < goal ? `<small>/${goal}</small>` : ''}${pts > 0 ? `<em>${pts}점</em>` : ''}`;
        const row = document.createElement('div');
        row.className = `cap-cards ${k}`;
        // 장수가 많아지면 겹침 간격을 줄여 정해진 폭 안에 넣는다 (단위: 카드 폭)
        const n = groups[k].length;
        const [maxW, step] = CAP_FIT[k];
        row.style.setProperty('--step', String(n > 1 ? Math.min(step, (maxW - 1) / (n - 1)) : step));
        row.append(...groups[k].map((id) => place(`c${id}`, 'up')));
        g.append(label, row);
        return g;
      });
      $(`cap-${p}`).replaceChildren(...nodes);

      // 족보 진행 표시: 칩 + 해당 패 테두리
      const progress = comboProgress(caps, s.players[p === 0 ? 1 : 0].captured);
      for (const id of caps) this.getEl(`c${id}`).removeAttribute('data-combo');
      for (const c of progress) {
        if (c.state === 'open') continue;
        for (const id of c.cards) this.getEl(`c${id}`).dataset.combo = c.key;
      }
      $(`combo-${p}`).innerHTML = progress
        .map((c) => `<span class="chip ${c.key} ${c.state}" title="${c.state === 'likely' ? '1장 남음' : ''}">${c.label}<b>${c.state === 'done' ? '✓' : `${c.have}/${c.need}`}</b></span>`)
        .join('');
    }

    // 사용하지 않는 요소 제거
    for (const [k, el] of this.els) if (!used.has(k)) el.remove();

    // 상호작용 표시
    const myTurn = !this.busy && s.current === 0;
    const floorMonths = new Set(s.floor.map(monthOf));
    for (const id of s.players[0].hand) {
      const el = this.els.get(`c${id}`)!;
      el.classList.toggle('playable', myTurn && s.phase === 'play');
      el.classList.toggle('match', myTurn && s.phase === 'play' && floorMonths.has(monthOf(id)));
    }
    for (let i = 0; i < s.players[0].dummies; i++) this.els.get(`d0-${i}`)?.classList.toggle('playable', myTurn && s.phase === 'play');
    for (const [k, el] of this.els) {
      if (!k.startsWith('c')) continue;
      const id = Number(k.slice(1));
      el.classList.toggle('choosable', myTurn && s.phase === 'chooseFloor' && !!s.choice?.options.includes(id));
      if (!s.players[0].hand.includes(id)) el.classList.remove('playable', 'match');
    }
    const hint = $('hint');
    if (myTurn && s.phase === 'chooseFloor') {
      hint.textContent = '가져올 패를 고르세요';
      hint.classList.add('show');
    } else if (myTurn && s.phase === 'play') {
      hint.textContent = '낼 패를 고르세요';
      hint.classList.add('show');
    } else hint.classList.remove('show');
    this.updateAdvice(s);

    this.renderInfo(s);
    this.renderMission(s);

    // FLIP
    let moved = false;
    let newcomer = 0;
    for (const [k, el] of this.els) {
      if (!el.isConnected) continue;
      const face = want.get(k)!;
      const prevFace = this.faces.get(k);
      const flipping = prevFace === 'down' && face === 'up';
      if (!flipping) this.setFace(el, k, face);
      const a = el.getBoundingClientRect();
      const isNew = !before.has(k);
      const b = before.get(k) ?? deckRect;
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const sx = b.width / a.width;
      const sy = b.height / a.height;
      if (!flipping && Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.02) continue;
      moved = true;
      const delayMs = isNew && dealing ? newcomer++ * 28 : 0;
      const from = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      const kf: Keyframe[] = flipping
        ? [{ transform: from }, { transform: `translate(${dx / 2}px, ${dy / 2}px) scale(0, ${(sy + 1) / 2})`, offset: 0.5 }, { transform: 'none' }]
        : [{ transform: from }, { transform: 'none' }];
      el.classList.add('animating');
      const anim = el.animate(kf, { duration: MOVE_MS, delay: delayMs, easing: 'cubic-bezier(.25,.8,.35,1)', fill: 'backwards' });
      if (flipping) setTimeout(() => this.setFace(el, k, face), delayMs + MOVE_MS / 2);
      anim.onfinish = () => el.classList.remove('animating');
    }
    return moved;
  }

  /** 미션 상자. 패마다 누가 가졌는지 표시한다. 내용이 바뀔 때만 다시 그린다 */
  private renderMission(s: GameState) {
    const m = s.mission;
    const cards = m?.cards.map((id) => {
      const owner = s.players[0].captured.includes(id) ? 'me' : s.players[1].captured.includes(id) ? 'opp' : '';
      return `<div class="m-card ${owner}"><div class="card">${cardSvg(id)}</div><span>${owner === 'me' ? '나' : owner === 'opp' ? '상대' : '&nbsp;'}</span></div>`;
    }).join('') ?? '';
    const html = m ? `<div class="m-head"><span class="m-title">미션</span><span class="m-value">${missionLabel(m)}</span></div><div class="m-cards">${cards}</div>` : '';
    const done = !!m && (missionDone(m, s.players[0].captured) || missionDone(m, s.players[1].captured));
    for (const id of ['mission-side', 'mission-top']) {
      const el = $(id);
      el.classList.toggle('hidden', !m);
      el.classList.toggle('done', done);
      if (html !== this.missionHtml) el.innerHTML = html;
    }
    this.missionHtml = html;
  }

  private async showMission() {
    const s = this.state;
    if (!s?.mission || !$('modal').classList.contains('hidden')) return;
    await this.dialog(
      `미션 ${missionLabel(s.mission)}`,
      `<div class="mission-pick">${this.cardRow(s.mission.cards)}</div>` +
        `<p style="text-align:center">이 패를 모두 가진 채 이기면 최종 점수에 <b>${missionLabel(s.mission)}</b> 적용합니다.<br>` +
        `<small>판이 끝날 때 가지고 있는 패로 판정합니다. 상대가 먼저 가져가면 막힙니다.</small></p>`,
      [{ label: '닫기', value: 'ok' }],
    );
  }

  private renderMeta() {
    const p = this.profile;
    $('meta').innerHTML =
      `<span>Lv.<b>${p.level}</b></span>` +
      `<span>점당 <b>${won(pointRate(p.level))}</b></span>` +
      `<span>전적 <b>${p.stats.wins}승 ${p.stats.losses}패 ${p.stats.draws}무</b></span>` +
      (p.nagariStreak ? `<span class="nagari">나가리 ×${nagariMultiplier(p.nagariStreak)}</span>` : '');
  }

  /**
   * 정보 패널: 이름·보유금 → 큰 점수와 목표까지의 막대 → 점수 내역 → 상태 표시(선·고·배수·위험) 순.
   * 판에 영향이 큰 정보(점수, 고, 배수, 피박·광박 위험)를 크게, 나머지는 작게 둔다.
   */
  private renderInfo(s: GameState | null = this.state) {
    for (const p of [0, 1] as const) {
      const ps = s?.players[p];
      const os = s?.players[p === 0 ? 1 : 0];
      const d = ps ? playerScore(ps) : null;
      const od = os ? playerScore(os) : null;
      const sc = d?.total ?? 0;
      // 고를 한 뒤에는 다음 고/스톱 기회가 "지난 고 점수 + 1점"이다
      const goal = ps?.goCount ? ps.lastGoScore + 1 : WIN_SCORE;
      const pct = Math.min(100, Math.round((sc / goal) * 100));
      const chips: string[] = [];
      if (s && s.dealer === p) chips.push('<span class="st dark">선</span>');
      if (ps?.goCount) chips.push(`<span class="st red">${ps.goCount}고</span>`);
      const mult = ps ? 2 ** (ps.shakes + ps.bombs) : 1;
      if (ps?.shakes) chips.push(`<span class="st gold">흔들기${ps.shakes > 1 ? ` ${ps.shakes}` : ''}</span>`);
      if (ps?.bombs) chips.push(`<span class="st gold">폭탄${ps.bombs > 1 ? ` ${ps.bombs}` : ''}</span>`);
      if (mult > 1) chips.push(`<span class="st gold">×${mult}</span>`);
      if (ps?.ppeokStreak) chips.push(`<span class="st dark">뻑 ${ps.ppeokStreak}</span>`);
      // 지금 상대가 스톱하면 적용될 위험 (settle과 같은 조건)
      if (ps && d && od) {
        if (od.piPoints > 0 && maxPiCount(ps.captured) < PIBAK_LIMIT) chips.push('<span class="st warn">피박 위험</span>');
        if (od.gwangPoints > 0 && d.gwangCount === 0) chips.push('<span class="st warn">광박 위험</span>');
      }
      const parts = d
        ? ([['광', d.gwangPoints], ['열끗', d.yeolPoints], ['띠', d.ttiPoints], ['피', d.piPoints]] as const).filter(([, v]) => v > 0)
        : [];
      const breakdown = parts.length ? parts.map(([k, v]) => `${k} <b>${v}</b>`).join(' · ') : '아직 점수 없음';
      const name = p === 0 ? '나' : this.profile.ai.name;
      const money = p === 0 ? this.profile.playerMoney : this.profile.ai.money;
      const active = !!s && s.phase !== 'end' && s.current === p;
      $(`info-${p}`).innerHTML =
        `<div class="name"><span>${name}</span>${active ? '<span class="turn">차례</span>' : p === 0 ? `<span class="tag">Lv.${this.profile.level}</span>` : '<span class="tag">AI</span>'}</div>` +
        `<div class="money">${won(money)}</div>` +
        `<div class="score${sc >= goal ? ' ready' : ''}"><b>${sc}</b><span>점</span><small>/ ${goal}</small></div>` +
        `<div class="bar"><i style="width:${pct}%"></i></div>` +
        `<div class="breakdown">${breakdown}</div>` +
        (chips.length ? `<div class="badges">${chips.join('')}</div>` : '');
      $(`info-${p}`).classList.toggle('active', active);
    }
  }

  // ───────────────────────── 대화상자 ─────────────────────────

  private dialog(title: string, body: string, buttons: { label: string; value: string; cls?: string }[]): Promise<string> {
    const modal = $('modal');
    const cls = title === '패배' ? 'lose' : title === '나가리' ? 'draw' : '';
    modal.innerHTML =
      `<div class="dialog"><h2 class="${cls}">${title}</h2>${body}<div class="actions">` +
      buttons.map((b, i) => `<button data-i="${i}" class="${b.cls ?? ''}">${b.label}</button>`).join('') +
      `</div></div>`;
    modal.classList.remove('hidden');
    return new Promise((resolve) => {
      modal.querySelectorAll('button').forEach((btn) =>
        btn.addEventListener('click', () => {
          unlockAudio();
          sfx.click();
          modal.classList.add('hidden');
          modal.innerHTML = '';
          resolve(buttons[Number(btn.dataset.i)].value);
        }),
      );
    });
  }

  private async showRules() {
    if (!$('modal').classList.contains('hidden')) return;
    await this.dialog(
      '규칙 요약',
      `<div class="rules">
        <h3>진행</h3><ul><li>손패 1장을 내 같은 월 패와 맞추고, 더미를 1장 뒤집어 다시 맞춥니다.</li>
        <li>먼저 ${WIN_SCORE}점 이상을 내면 <b>고</b>(계속) 또는 <b>스톱</b>(정산)을 선택합니다.</li>
        <li>두 사람 모두 스톱하지 못하면 <b>나가리</b>, 다음 판 점수 ×2 (연속 시 누적).</li></ul>
        <h3>점수</h3><ul><li>광: 3광 3점(비광 포함 2점), 4광 4점, 5광 15점</li>
        <li>열끗·띠 5장 1점, 피 10장 1점 (이후 1장마다 +1)</li>
        <li>고도리 5점, 홍단·청단·초단 각 3점</li>
        <li>💡 추천을 켜 두면 내 차례마다 공개된 패만 보고 둘 만한 패를 표시합니다.</li>
        <li>쌍피 2장, 보너스 쌍피 2장, 쓰리피 3장으로 계산. 보너스패를 가져가면 상대 피 1장을 빼앗습니다(일반 피 우선). 국진(9월 술잔)은 열끗으로 계산하며, 7점에 닿을 때 쌍피로 전환할지 묻습니다</li></ul>
        <h3>특수</h3><ul><li>쪽·따닥·뻑 먹기(바닥에 깔린 3장 포함)·싹쓸이·폭탄: 상대 피 1장 (자뻑 2장)</li>
        <li>첫뻑: 각자의 첫 턴에 뻑이 나면 상대에게서 ${FIRST_PPEOK_POINTS}점에 해당하는 금액을 바로 받습니다</li>
        <li>흔들기·폭탄: 점수 ×2 · 폭탄은 손 3장+바닥 1장 또는 손 2장+바닥 2장 · 총통·삼연뻑: 즉시 ${10}점 승리</li>
        <li>1고 +1, 2고 +2, 3고부터 ×2씩</li>
        <li>피박·광박·멍박·고박: 각 ×2</li></ul>
        <h3>획득 미션</h3><ul><li>판마다 30% 확률로 발생하며, 보너스패를 뺀 패 2~3장과 보상(+ 1~5 또는 x 2~5)을 판 시작 때 보여 줍니다.</li>
        <li>미션 패를 모두 가진 채 이기면 모든 배수를 계산한 최종 점수에 보상을 적용합니다. 고/스톱 기준 점수에는 영향이 없습니다.</li>
        <li>판정은 판이 끝날 때 가진 패로 합니다. 패자가 완료한 미션과 총통·삼연뻑 승리에는 적용하지 않습니다.</li></ul>
        <h3>금액</h3><ul><li>점당 금액 = (레벨÷5의 몫 + 1) × 100원</li>
        <li>AI가 파산하면 레벨 업, 새 AI는 이전 AI 시작 금액의 0~40% 증액</li>
        <li>내가 파산하면 처음부터 다시 시작</li></ul></div>`,
      [{ label: '닫기', value: 'ok' }],
    );
  }
}
