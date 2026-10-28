// Web Audio API로 효과음을 합성한다 (외부 음원 파일 없음).

let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem('gostop-muted') === '1';
} catch {
  /* 저장소 접근 불가 */
}

export const isMuted = () => muted;
export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem('gostop-muted', v ? '1' : '0');
  } catch {
    /* 무시 */
  }
}

/** 사용자 입력 이후에 호출해야 오디오가 켜진다 */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function ready(): AudioContext | null {
  if (muted || !ctx || ctx.state !== 'running') return null;
  return ctx;
}

function noiseHit(at: number, dur: number, freq: number, gain: number, q = 1.2) {
  const c = ready();
  if (!c) return;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c.destination);
  src.start(c.currentTime + at);
}

function tone(at: number, dur: number, freq: number, type: OscillatorType, gain: number, slideTo?: number) {
  const c = ready();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const arp = (notes: number[], step: number, type: OscillatorType, gain: number, dur = 0.18) =>
  notes.forEach((f, i) => tone(i * step, dur, f, type, gain));

export const sfx = {
  /** 패를 바닥에 탁 내려놓는 소리 */
  place() {
    noiseHit(0, 0.09, 1800, 0.9);
    tone(0, 0.06, 180, 'sine', 0.25);
  },
  flip() {
    noiseHit(0, 0.12, 4200, 0.35, 0.7);
    noiseHit(0.1, 0.08, 1600, 0.7);
  },
  capture() {
    noiseHit(0, 0.07, 2200, 0.5);
    noiseHit(0.07, 0.07, 2600, 0.45);
  },
  deal() {
    for (let i = 0; i < 6; i++) noiseHit(i * 0.05, 0.05, 3000, 0.25);
  },
  special() {
    arp([660, 880, 1320], 0.07, 'triangle', 0.22);
  },
  steal() {
    tone(0, 0.18, 520, 'square', 0.08, 1040);
  },
  ppeok() {
    tone(0, 0.45, 260, 'sawtooth', 0.12, 90);
    noiseHit(0, 0.2, 400, 0.6);
  },
  bomb() {
    noiseHit(0, 0.5, 120, 1.4, 0.6);
    tone(0, 0.4, 110, 'sine', 0.35, 40);
  },
  go(count: number) {
    const base = 440 * 2 ** (Math.min(count, 5) / 12);
    arp([base, base * 1.26, base * 1.5, base * 2], 0.08, 'square', 0.1, 0.16);
  },
  stop() {
    [523, 659, 784].forEach((f) => tone(0, 0.6, f, 'triangle', 0.14));
  },
  combo() {
    arp([523, 659, 784, 1047, 1319], 0.08, 'triangle', 0.18, 0.25);
  },
  win() {
    arp([523, 659, 784, 1047, 784, 1047], 0.12, 'triangle', 0.18, 0.3);
  },
  lose() {
    arp([392, 349, 311, 262], 0.18, 'sine', 0.2, 0.35);
  },
  nagari() {
    arp([440, 415, 392], 0.15, 'sine', 0.15, 0.3);
  },
  levelUp() {
    arp([392, 523, 659, 784, 1047, 1319, 1568], 0.07, 'square', 0.08, 0.2);
  },
  click() {
    tone(0, 0.05, 900, 'sine', 0.08);
  },
};
