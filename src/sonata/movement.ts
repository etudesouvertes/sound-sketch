import * as Tone from "tone";
import type { L } from "../i18n";
import { type Pitch, pitchAt, type Scale } from "../scales";
import { ledgersFor, musicLeft, staffLayout } from "./staff";

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
// tuning と prepared は、その作曲家を選んだときの設定の「調律」と「プリペアド・ピアノ」の初めの値（書かなければ、ぴったり・切）
export type Sonata = { id: string; composer: L; initials: string; scale: Scale; movements: Movement[]; tuning?: Tuning; prepared?: boolean };
export type Tuning = "exact" | "loose" | "old";

// 作曲家の音階のうち、何人かで共有するもの
export const CHROMATIC: Scale = { id: "chromatic", group: "", name: { ja: "半音階", en: "Chromatic" }, steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
export const DORIAN: Scale = { id: "dorian", group: "", name: { ja: "ドリアン", en: "Dorian" }, steps: [0, 2, 3, 5, 7, 9, 10] };
export const AEOLIAN: Scale = { id: "aeolian", group: "", name: { ja: "エオリアン（自然短音階）", en: "Aeolian (natural minor)" }, steps: [0, 2, 3, 5, 7, 8, 10] };

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

// 今の音高の並びでの、主音の位置と 1 オクターブの音の数。
// 主音が 1 つしか見えないときの 1 オクターブの音の数は、楽章が決める（半音階を前提にした楽章は 12、7 音の音階なら 7）
export function layout(ctx: MovementContext, fallbackPerOctave = 7) {
  const pitches = ctx.pitches();
  const count = pitches.length;
  const roots = pitches.flatMap((p, i) => (p.isRoot ? [i] : []));
  const perOctave = roots.length >= 2 ? roots[1] - roots[0] : fallbackPerOctave;
  const lowRoot = roots[0] ?? 0;
  const topRoot = roots.at(-1) ?? count - 1;
  const middle = Math.floor(count / 2);
  const centre = roots.reduce((best, r) => (Math.abs(r - count / 2) < Math.abs(best - count / 2) ? r : best), roots[0] ?? middle);
  // 7 音の音階の度数（0〜）を、今の音階の段数に直す（5 音の音階でも和音の形がおおよそ保たれる）
  const degree = (d: number) => Math.round((d * perOctave) / 7);
  // 音の位置ごとの、主音からの半音の数（0〜11）
  const rootFreq = pitches[lowRoot]?.freq ?? 261.63;
  const semitone = (i: number) => ((Math.round(12 * Math.log2(pitches[i].freq / rootFreq)) % 12) + 12) % 12;
  // 画面の外の音は、オクターブを指定して鳴らす
  const place = (index: number) => {
    const octave = index < 0 ? -Math.ceil(-index / perOctave) : index >= count ? Math.ceil((index - count + 1) / perOctave) : 0;
    return { index: index - octave * perOctave, octave };
  };
  return { pitches, count, perOctave, lowRoot, topRoot, middle, centre, degree, semitone, place };
}
export type Layout = ReturnType<typeof layout>;

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

export const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
export const clamp = (x: number, min: number, max: number) => Math.min(Math.max(x, min), max);

// --- 画面: 鳴った音の印が、右端から左へ流れる（windowSeconds 秒で左端に着いて消える） ---

// 印に共通の項目。楽章ごとに、色を決める項目（hue や voice など）を足す
export type FlowMark = { time: number; index: number; seconds: number; velocity: number };
// 1 つの印を描く。ringing は鳴り残り（1 → 0）、fade は消えるまでの残り（1 → 0）、span は流れる幅（px）。
// note(radius) は、その位置に今の塗りの色で音符（斜めの楕円の符頭と、要るときは加線）を描く。radius は丸で描いたときの半径
export type PaintMark<M extends FlowMark> = (
  g: CanvasRenderingContext2D,
  m: M,
  x: number,
  y: number,
  ringing: number,
  fade: number,
  span: number,
  note: (radius: number) => void,
) => void;
export type FlowView<M extends FlowMark> = {
  add: (m: M) => () => void; // 音が鳴る時刻に印を足す関数を返す（Pending の onPlay に渡す）
  clear: () => void;
  draw: (g: CanvasRenderingContext2D, width: number, height: number) => void;
};

const midiOf = (freq: number) => 69 + 12 * Math.log2(freq / 440);

// 符頭の形。丸の半径に対する横の半径、縦と横の比、傾き（ラジアン。右上がり）
const NOTE_WIDTH = 1.2;
const NOTE_RATIO = 0.68;
const NOTE_TILT = -0.35;

export function flowView<M extends FlowMark>(ctx: MovementContext, windowSeconds: number, paint: PaintMark<M>): FlowView<M> {
  let marks: M[] = [];
  return {
    add: (m) => () => marks.push(m),
    clear: () => (marks = []),
    draw(g, width, height) {
      const now = Tone.now();
      marks = marks.filter((m) => now - m.time < windowSeconds);
      const pitches = ctx.pitches();
      const count = pitches.length;
      const band = height / count;
      // 音符は、音部記号と調号の右で消える
      const left = Math.max(MARGIN_LEFT, musicLeft());
      const span = width - left - MARGIN_RIGHT;
      const staff = staffLayout(pitches, height);
      const placed = marks
        .map((m) => ({ m, x: width - MARGIN_RIGHT - ((now - m.time) / windowSeconds) * span, y: yOf(clamp(m.index, 0, count - 1), height, count) }))
        .filter((p) => p.x >= left)
        .sort((a, b) => a.x - b.x);
      placed.forEach(({ m, x, y }, i) => {
        const fade = 1 - (now - m.time) / windowSeconds;
        const ringing = Math.max(0, 1 - (now - m.time) / m.seconds);
        paint(g, m, x, y, ringing, fade, span, (radius) => {
          // 速いパッセージでは、前後の音符（高さが近いもの）に重ならない幅まで符頭を細くする。同時に鳴る音（和音）は数えない
          let room = radius * NOTE_WIDTH;
          for (const j of [i - 1, i + 1]) {
            for (let k = j; k >= 0 && k < placed.length; k += j < i ? -1 : 1) {
              const dx = Math.abs(placed[k].x - x);
              if (dx >= room * 2) break;
              if (dx >= 1 && Math.abs(placed[k].y - y) < band * 1.5) room = Math.min(room, dx / 2 - 0.5);
            }
          }
          const rx = Math.max(room, 1.5);
          const ry = Math.min(rx * NOTE_RATIO, radius * NOTE_WIDTH * NOTE_RATIO);
          const ledgers = ledgersFor(staff, y);
          if (ledgers.length > 0) {
            g.strokeStyle = g.fillStyle;
            g.lineWidth = 1.2;
            g.beginPath();
            for (const ly of ledgers) {
              g.moveTo(x - rx * 1.6, ly);
              g.lineTo(x + rx * 1.6, ly);
            }
            g.stroke();
          }
          g.beginPath();
          g.ellipse(x, y, rx, ry, NOTE_TILT, 0, Math.PI * 2);
          g.fill();
          // 臨時記号は符頭の左に
          const sign = staff.written(midiOf(pitchAt(pitches, m.index).freq));
          if (sign) {
            const size = Math.max(ry * 3.4, 9);
            g.font = `${size}px "Segoe UI Symbol", "Apple Symbols", "Noto Music", serif`;
            g.textAlign = "right";
            g.textBaseline = "middle";
            g.fillText(sign, x - rx * 1.25, y + (sign === "♭" ? -size * 0.12 : size * 0.07));
            g.textBaseline = "alphabetic";
          }
        });
      });
    },
  };
}

// 音の時刻に合わせて切り替わる表示の値。予定の時刻と値を時刻順に貯めておき、描くときに今の時刻までに来た最後の値を使う
// （1 拍ごとに Tone.getDraw() の予定を入れると、タブを裏に回して描画が止まっているあいだに予定がたまる）
export function timed<T>(initial: T) {
  let current = initial;
  let pending: { time: number; value: T }[] = [];
  return {
    set: (time: number, value: T) => pending.push({ time, value }),
    get(): T {
      const now = Tone.now();
      while (pending.length > 0 && pending[0].time <= now) current = pending.shift()!.value;
      return current;
    },
    clear: () => (pending = []),
  };
}

// 色相で色分けする印と、その印を付けて音を鳴らす手順（画面の外の音は、オクターブを指定して鳴らす）
export type HueMark = FlowMark & { hue: number };
export type Queue = ReturnType<typeof pendingQueue>;
export function note(h: Layout, queue: Queue, view: FlowView<HueMark>, index: number, time: number, velocity: number, seconds: number, hue: number) {
  queue.add({ time, ...h.place(index), velocity, seconds, onPlay: view.add({ time, index, hue, seconds, velocity }) });
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
  // 楽章は、刻みの頭で queue を流してから、その刻みの幅の音を足す。流し終えた幅に入る音は、待たせずにすぐ鳴らす
  // （次の刻みまで待たせると、どの音も刻みの頭に寄って、0.1 秒の格子に揃ってしまう）
  let flushedAt = -Infinity;
  const play = (p: Pending) => {
    const at = Math.max(p.time, flushedAt);
    ctx.piano.triggerAttackRelease(pitchAt(ctx.pitches(), p.index).freq * 2 ** ((p.octave ?? 0) + (p.cents ?? 0) / 1200), p.seconds, at, p.velocity);
    if (p.onPlay) Tone.getDraw().schedule(p.onPlay, at);
  };
  return {
    add(p: Pending) {
      if (p.time < flushedAt + TICK) play(p);
      else queue.push(p);
    },
    flush(time: number) {
      flushedAt = time;
      const due = queue.filter((p) => p.time < time + TICK);
      queue = queue.filter((p) => p.time >= time + TICK);
      for (const p of due) play(p);
    },
    clear: () => (queue = []),
  };
}
