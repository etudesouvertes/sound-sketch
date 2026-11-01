import * as Tone from "tone";
import type { L } from "../i18n";
import { type Pitch, pitchAt, type Scale } from "../scales";

// ソナタの楽章に共通の形。楽章は始まりから終わりまでの流れを自分で持ち、終わったら finished() が true になる。
// ページ（main.ts）は、終わった楽章を止めて次の楽章を始め、III が終わったらソナタを終える

export type MovementContext = {
  piano: Tone.Sampler;
  transport: ReturnType<typeof Tone.getTransport>;
  pitches: () => Pitch[]; // 画面に割り当てている音高（低い順）
  density: () => number; // 密度の段階・天気・変化を掛け合わせた頻度の倍率（標準 1）
  bpm: () => number; // 速い楽章のテンポ（設定 × 天気）
};

export type MovementRun = {
  pointer: (x: number, y: number, height: number) => void;
  draw: (g: CanvasRenderingContext2D, width: number, height: number) => void;
  finished: () => boolean;
  stop: () => void;
};

export type Movement = {
  title: L;
  duration: number; // 目安の長さ（秒）。終わり方は楽章ごとに違うので、少し前後する
  start: (ctx: MovementContext) => MovementRun;
};

// scale は、設定のスケールで「指定しない」を選んだときに使う、その作曲家の音階
// initials は、作曲家のプルダウンに出す頭文字（右下の表示とヘルプはフルネーム）
// tunable を付けた作曲家だけ、設定の「調律」を選べる（ほかの作曲家は常にぴったり）
export type Sonata = { id: string; composer: L; initials: string; scale: Scale; movements: Movement[]; tunable?: boolean };

// Transport の上で、今から seconds 秒後の位置（ティックで指定する）。
// transport.seconds + seconds と書くと、Tone.js はその秒を今のテンポで拍に換算する。経過秒はテンポの変化の履歴で
// 積み上がっているので、テンポを変えてきたあと（一柳慧の III は加速する）では、何分も先の位置になってしまう
export function after(transport: MovementContext["transport"], seconds: number): string {
  return `${transport.ticks + Math.round(Tone.Time(seconds).toTicks())}i`;
}

export const MARGIN_LEFT = 56;
export const MARGIN_RIGHT = 24;

export function yOf(index: number, height: number, count: number): number {
  return height - (index + 0.5) * (height / count);
}

// 楽章が使う乱数。種から決まる並びなので、同じ種・同じ設定なら同じ演奏になる（ページが楽章ごとに種を入れる）。
// 楽章の中では Math.random でなく、rand と random を使う
let state = 1;
export function rand(): number {
  // mulberry32
  state = (state + 0x6d2b79f5) | 0;
  let x = Math.imul(state ^ (state >>> 15), 1 | state);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
export function seedRandom(text: string) {
  // 文字列から 32 ビットの値を作る（FNV-1a）
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  state = h | 0;
}
// クリックのように、演奏の外から来た出来事で使った乱数が、その先の並びを変えないようにする
export function keepRandom(action: () => void) {
  const saved = state;
  action();
  state = saved;
}

export function random(min: number, max: number): number {
  return min + rand() * (max - min);
}

// 音の時計（AudioContext の時刻）で予定を立てる部品。刻みを持たない楽章（イーノ、ペルト）で使う

export const TICK = 0.1; // 先読みの幅（秒）。この幅の中に来る音を、正確な時刻を指定して鳴らす

// 音の時計で動く小さな予定表。stop() で、まだ鳴っていない予定ごと止められる
export function scheduler(ctx: MovementContext, tick: (time: number) => void) {
  return new Tone.Loop((time) => tick(time), TICK).start(after(ctx.transport, 0.05));
}

// cents は、平均律からのずれ（半音の 100 分の 1。純正律などで使う）
export type Pending = { time: number; index: number; velocity: number; seconds: number; octave?: number; cents?: number; onPlay?: () => void };

// 先の時刻の音を貯めておき、時刻が近づいたら鳴らす
export function pendingQueue(ctx: MovementContext) {
  let queue: Pending[] = [];
  return {
    add: (p: Pending) => queue.push(p),
    flush(time: number) {
      const due = queue.filter((p) => p.time < time + TICK);
      queue = queue.filter((p) => p.time >= time + TICK);
      const pitches = ctx.pitches();
      for (const p of due) {
        ctx.piano.triggerAttackRelease(pitchAt(pitches, p.index).freq * 2 ** ((p.octave ?? 0) + (p.cents ?? 0) / 1200), p.seconds, Math.max(p.time, time), p.velocity);
        if (p.onPlay) Tone.getDraw().schedule(p.onPlay, Math.max(p.time, time));
      }
    },
    clear: () => (queue = []),
  };
}
