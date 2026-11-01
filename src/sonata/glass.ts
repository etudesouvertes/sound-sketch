import * as Tone from "tone";
import { pitchIndexAt } from "../scales";
import { layout, type Layout, MARGIN_LEFT, MARGIN_RIGHT, type Movement, type MovementContext, pendingQueue, rand, random, scheduler, type Sonata, TICK, yOf } from "./movement";

// フィリップ・グラスがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// I.   足し算と引き算: 短い音型を、頭から 2 音、3 音…と 1 音ずつ足しながら決まった回数ずつ繰り返し、全部そろったら 1 音ずつ減らす。
//      左手は和音の低い音を刻み続け、音型が替わるたびに和音も移る
// II.  揺り返す和音: 左手が 2 つの和音を 1 小節ずつ分散和音で揺り返し、右手は長い音の素朴な旋律を、もう一度同じ形で弾く。
//      区切りは A B A C … と並び、A が何度も同じ形で戻ってくる
// III. 3 対 2: 右手は 3 つずつ、左手は 2 つずつの速い分散和音を重ね、4 つの和音の巡りを何度も回す。区切りごとに右手の型が広がり、
//      強くなって熱を帯び、最後は突然止まる

// --- 画面: 鳴った音が右端から左へ流れる。上には、楽章ごとの仕組み（音型・区切り・巡り）を出す ---

type Mark = { time: number; index: number; hue: number; seconds: number; velocity: number };
const WINDOW = 10;

function markView(ctx: MovementContext) {
  let marks: Mark[] = [];
  return {
    add: (m: Mark) => () => marks.push(m),
    clear: () => (marks = []),
    draw(g: CanvasRenderingContext2D, width: number, height: number) {
      const now = Tone.now();
      marks = marks.filter((m) => now - m.time < WINDOW);
      const count = ctx.pitches().length;
      const span = width - MARGIN_LEFT - MARGIN_RIGHT;
      for (const m of marks) {
        const x = width - MARGIN_RIGHT - ((now - m.time) / WINDOW) * span;
        if (x < MARGIN_LEFT) continue;
        const y = yOf(Math.min(Math.max(m.index, 0), count - 1), height, count);
        const fade = 1 - (now - m.time) / WINDOW;
        const ringing = Math.max(0, 1 - (now - m.time) / m.seconds);
        g.fillStyle = `hsla(${m.hue}, 55%, ${58 + 20 * ringing}%, ${(0.2 + 0.6 * ringing) * fade})`;
        g.beginPath();
        g.arc(x, y, 2 + 5 * m.velocity + 2 * ringing, 0, Math.PI * 2);
        g.fill();
      }
    },
  };
}

type Queue = ReturnType<typeof pendingQueue>;
type View = ReturnType<typeof markView>;

const RIGHT = 200;
const LEFT = 35;

function note(h: Layout, queue: Queue, view: View, index: number, time: number, velocity: number, seconds: number, hue: number) {
  queue.add({ time, ...h.place(index), velocity, seconds, onPlay: view.add({ time, index, hue, seconds, velocity }) });
}

// 度数（主音から数える。7 で 1 オクターブ上）の音の位置。右手は真ん中の主音から、左手は画面の一番下の主音から数える
const high = (h: Layout, degree: number) => h.centre + h.degree(degree);
const low = (h: Layout, degree: number) => h.lowRoot + h.degree(degree);

const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];

// クリック: その高さの音に、3 度上の音を添えて鳴らす
function pointAt(ctx: MovementContext, queue: Queue, view: View, y: number, height: number) {
  const h = layout(ctx);
  const index = Math.min(Math.max(pitchIndexAt(y, height, h.count), 0), h.count - 1);
  const time = Tone.now() + 0.02;
  note(h, queue, view, index, time, 0.3, 1.2, 50);
  note(h, queue, view, index + h.degree(2), time, 0.22, 1.2, 50);
}

// 上に小さな箱を並べる（今の所は明るく、使っている所は少し明るく）
function boxes(g: CanvasRenderingContext2D, labels: string[], used: number, current: number, top = 66) {
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "center";
  labels.forEach((label, i) => {
    const x = MARGIN_LEFT + i * 22;
    g.fillStyle = i === current ? "rgba(240, 200, 120, 0.8)" : i < used ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.08)";
    g.fillRect(x, top, 18, 14);
    if (label) {
      g.fillStyle = i === current ? "rgba(30, 30, 30, 0.9)" : "rgba(255, 255, 255, 0.6)";
      g.fillText(label, x + 9, top + 11);
    }
  });
}

// --- I. 足し算と引き算 ---

const STAGES = [2, 3, 4, 5, 6, 5, 4, 3, 2]; // 繰り返す音型の長さ（足して、減らす）
const REPEATS = 4; // 1 つの長さを繰り返す回数
const PROGRESSION_I = [0, 5, 3, 4, 0, 2, 5, 4]; // 区切り（音型）ごとの和音の根音
const BASS = [0, 4, 7, 4]; // 左手の 4 分音符の型（和音の根音からの度数）

// 音型: 和音の音を中心に、ときどき隣の音を混ぜた 6 音
function newFigure(root: number): number[] {
  const tones = [0, 2, 4, 7].map((d) => root + d);
  return Array.from({ length: 6 }, (_, i) => (i === 0 ? root + pick([0, 2, 4]) : pick(tones) + (rand() < 0.2 ? 1 : 0)));
}

const additive: Movement = {
  title: { ja: "I. 足し算と引き算", en: "I. Addition and subtraction" },
  duration: 210,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const eighth = () => 30 / ctx.bpm();
    const figures = PROGRESSION_I.map(newFigure);
    let section = 0;
    let stage = 0;
    let rep = 0;
    let pos = 0;
    let step = 0; // 8 分音符を数える（左手の刻みのため）
    let eighthAt = startAt + 0.4;
    let final = false; // 最後の区切り（最初の音型に戻り、全部の長さで弾いて終わる）
    let ending = false;
    let shown = { length: STAGES[0], pos: 0, rep: 0 };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      while (!ending && eighthAt < time + TICK) {
        const h = layout(ctx);
        const e = eighth();
        const root = PROGRESSION_I[section % PROGRESSION_I.length];
        const figure = figures[section % figures.length];
        const length = final ? 6 : STAGES[stage];
        const accent = pos === 0 ? 1.2 : 1;
        note(h, queue, view, high(h, figure[pos]), eighthAt, 0.28 * accent * random(0.95, 1.05), e * 1.4, RIGHT);
        if (step % 2 === 0) note(h, queue, view, low(h, root + BASS[(step / 2) % 4]), eighthAt, 0.24, e * 2.4, LEFT);
        const state = { length, pos, rep };
        Tone.getDraw().schedule(() => (shown = state), eighthAt);
        step++;
        eighthAt += e;
        pos++;
        if (pos < length) continue;
        pos = 0;
        rep++;
        if (rep < REPEATS) continue;
        rep = 0;
        if (final) {
          // 終わり: 最初の和音を長く置く
          ending = true;
          for (const d of [0, 2, 4]) note(h, queue, view, high(h, d), eighthAt, 0.3, 4, RIGHT);
          note(h, queue, view, low(h, 0), eighthAt, 0.3, 4.5, LEFT);
          endAt = eighthAt + 5;
          break;
        }
        stage++;
        if (stage < STAGES.length) continue;
        // 次の音型へ。残りの時間に 1 区切り（足して減らすひと回り）が収まらなければ、最後の区切りにする
        stage = 0;
        section++;
        const sectionLength = STAGES.reduce((a, b) => a + b, 0) * REPEATS * e;
        if (eighthAt - startAt + sectionLength > additive.duration) {
          final = true;
          section = 0;
        }
      }
    });

    return {
      pointer: (_x, y, height) => !ending && pointAt(ctx, queue, view, y, height),
      draw: (g, width, height) => {
        view.draw(g, width, height);
        // 音型の 6 音を箱で出す。今繰り返している長さの所が明るく、右に何回目かを点で出す
        boxes(g, ["", "", "", "", "", ""], shown.length, shown.pos);
        for (let i = 0; i < REPEATS; i++) {
          g.fillStyle = i <= shown.rep ? "rgba(240, 200, 120, 0.7)" : "rgba(255, 255, 255, 0.12)";
          g.beginPath();
          g.arc(MARGIN_LEFT + 6 * 22 + 10 + i * 10, 73, 3, 0, Math.PI * 2);
          g.fill();
        }
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
        queue.clear();
        view.clear();
      },
    };
  },
};

// --- II. 揺り返す和音 ---

// 区切りの種類ごとの和音の組（根音の度数）。A は主和音から始まる
const PAIRS_A = [
  [0, 5],
  [0, 3],
  [0, 6],
];
const PAIRS_OTHER = [
  [5, 3],
  [3, 4],
  [5, 6],
  [2, 5],
  [3, 6],
];
const ROCK = [0, 4, 9, 4]; // 左手の 4 分音符の分散和音（根音・5 度・1 オクターブ上の 3 度・5 度）
const ORDER_II = ["A", "B", "A", "C"] as const;
type Part = (typeof ORDER_II)[number];

type Held = { at: number; beats: number; degree: number };

// 右手の旋律: 1 小節に 1〜2 つの長い音。和音の音から、前の音にいちばん近いものを選ぶ
function newMelody(pair: number[]): Held[][] {
  let previous = 9;
  return Array.from({ length: 4 }, (_, bar) => {
    const root = pair[bar % 2];
    const rhythm = pick([[[0, 4]], [[0, 2], [2, 2]], [[0, 3], [3, 1]], [[1, 3]]]) as [number, number][];
    return rhythm.map(([at, beats]) => {
      const tones = [root, root + 2, root + 4, root + 7, root + 9, root + 11].filter((d) => d >= 5 && d <= 13);
      const choices = tones.filter((d) => d !== previous);
      previous = choices.reduce((best, d) => (Math.abs(d - previous) < Math.abs(best - previous) ? d : best), choices[0]);
      return { at, beats, degree: previous };
    });
  });
}

const rocking: Movement = {
  title: { ja: "II. 揺り返す和音", en: "II. Rocking chords" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const quarter = () => 66 / ctx.bpm();
    const pairs: Record<Part, number[]> = { A: pick(PAIRS_A), B: pick(PAIRS_OTHER), C: pick(PAIRS_OTHER) };
    if (pairs.C === pairs.B) pairs.C = PAIRS_OTHER[(PAIRS_OTHER.indexOf(pairs.B) + 1) % PAIRS_OTHER.length];
    const melodies: Record<Part, Held[][]> = { A: newMelody(pairs.A), B: newMelody(pairs.B), C: newMelody(pairs.C) };
    const played: Part[] = [];
    let part: Part = "A";
    let bar = 0; // 区切りの中の小節（4 小節の旋律を 2 回で 8 小節）
    let barAt = startAt + 0.4;
    let final = false;
    let ending = false;
    let shown = 0;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending || barAt >= time + TICK) return;
      const h = layout(ctx);
      const q = quarter();
      if (bar === 0) {
        played.push(part);
        const index = played.length - 1;
        Tone.getDraw().schedule(() => (shown = index), barAt);
      }
      const root = pairs[part][bar % 2];
      ROCK.forEach((d, i) => note(h, queue, view, low(h, root + d), barAt + i * q, 0.22 * (i === 0 ? 1.15 : 1), q * 1.8, LEFT));
      const second = bar >= 4;
      for (const t of melodies[part][bar % 4]) {
        const at = barAt + t.at * q;
        note(h, queue, view, high(h, t.degree), at, 0.3 * random(0.95, 1.05), t.beats * q * 1.1, RIGHT);
        // 2 回目は、1 オクターブ下を重ねて厚くする
        if (second) note(h, queue, view, high(h, t.degree - 7), at, 0.18, t.beats * q * 1.1, RIGHT);
      }
      bar++;
      barAt += 4 * q;
      if (bar < (final ? 4 : 8)) return;
      bar = 0;
      if (final) {
        // 終わり: 主和音を長く置く
        ending = true;
        note(h, queue, view, low(h, 0), barAt, 0.28, q * 8, LEFT);
        for (const d of [0, 2, 4]) note(h, queue, view, high(h, d + 7), barAt, 0.24, q * 8, RIGHT);
        endAt = barAt + q * 8;
        return;
      }
      part = ORDER_II[played.length % ORDER_II.length];
      // 残りの時間に 1 区切りが収まらなければ、A を 1 回だけ弾いて終わる
      if (barAt - startAt + 8 * 4 * q > rocking.duration) {
        part = "A";
        final = true;
      }
    });

    return {
      pointer: (_x, y, height) => !ending && pointAt(ctx, queue, view, y, height),
      draw: (g, width, height) => {
        view.draw(g, width, height);
        // 弾いてきた区切りの並び（A B A C …）。今の区切りが明るい
        const recent = played.slice(-16);
        const offset = played.length - recent.length;
        boxes(g, recent, recent.length, shown - offset);
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
        queue.clear();
        view.clear();
      },
    };
  },
};

// --- III. 3 対 2 ---

// 和音の巡り（根音の度数）。区切りごとに、どの巡りを回すかを決める（最初の巡りが何度も戻る）
const CYCLES = [
  [0, 5, 2, 6],
  [3, 4, 0, 5],
  [5, 3, 6, 4],
];
const CYCLE_ORDER = [0, 0, 1, 0, 2, 0];
// 右手の 3 つずつの型（和音の根音からの度数）。区切りが進むごとに広がる
const RIGHT_PATTERNS = [
  [0, 2, 4, 2, 4, 2],
  [0, 2, 4, 7, 4, 2],
  [0, 4, 7, 9, 7, 4],
  [0, 4, 7, 11, 9, 7],
];
const LEFT_PATTERN = [0, 4, 7, 4]; // 左手の 2 つずつの型
const TURNS = 4; // 1 つの巡りを回す回数

const threeTwo: Movement = {
  title: { ja: "III. 3 対 2", en: "III. Three against two" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const beat = () => 60 / ctx.bpm();
    let section = 0;
    let turn = 0;
    let chord = 0;
    let chordAt = startAt + 0.4;
    let ending = false;
    let shown = { cycle: CYCLES[0], chord: 0 };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending || chordAt >= time + TICK) return;
      const h = layout(ctx);
      const b = beat();
      const progress = Math.min((chordAt - startAt) / threeTwo.duration, 1);
      const cycle = CYCLES[CYCLE_ORDER[section % CYCLE_ORDER.length]];
      const root = cycle[chord];
      const level = Math.min(Math.floor(progress * RIGHT_PATTERNS.length), RIGHT_PATTERNS.length - 1);
      const velocity = 0.2 + 0.16 * progress;
      // 1 つの和音に 2 拍。右手は 3 連符で 6 音、左手は 8 分音符で 4 音
      RIGHT_PATTERNS[level].forEach((d, i) => note(h, queue, view, high(h, root + d), chordAt + (i * 2 * b) / 6, velocity * (i % 3 === 0 ? 1.15 : 1), b * 0.5, RIGHT));
      LEFT_PATTERN.forEach((d, i) => note(h, queue, view, low(h, root + d), chordAt + (i * 2 * b) / 4, velocity * (i % 2 === 0 ? 1.1 : 0.95), b * 0.7, LEFT));
      const state = { cycle, chord };
      Tone.getDraw().schedule(() => (shown = state), chordAt);
      chordAt += 2 * b;
      chord++;
      if (chord < cycle.length) return;
      chord = 0;
      turn++;
      if (turn < TURNS) return;
      turn = 0;
      section++;
      // 残りの時間に 1 区切りが収まらなければ、主和音を強く 1 回鳴らして、突然止まる
      if (chordAt - startAt + TURNS * 4 * 2 * b > threeTwo.duration) {
        ending = true;
        for (const d of [0, 2, 4, 7]) note(h, queue, view, high(h, d), chordAt, 0.42, b * 0.6, RIGHT);
        for (const d of [0, 7]) note(h, queue, view, low(h, d), chordAt, 0.4, b * 0.6, LEFT);
        endAt = chordAt + 3;
      }
    });

    return {
      pointer: (_x, y, height) => !ending && pointAt(ctx, queue, view, y, height),
      draw: (g, width, height) => {
        view.draw(g, width, height);
        // 4 つの和音の巡り。今の和音が明るい
        const names = ["i", "ii°", "III", "iv", "v", "VI", "VII"]; // エオリアンの和音の名前
        boxes(g, shown.cycle.map((r) => names[r % 7]), 4, shown.chord);
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
        queue.clear();
        view.clear();
      },
    };
  },
};

export const glass: Sonata = {
  id: "glass",
  composer: { ja: "フィリップ・グラス", en: "Philip Glass" },
  initials: "P.G.",
  // エオリアン（自然的短音階）。短調の分散和音の揺り返しになじむ
  scale: { id: "aeolian", group: "", name: { ja: "エオリアン", en: "Aeolian" }, steps: [0, 2, 3, 5, 7, 8, 10] },
  movements: [additive, rocking, threeTwo],
};
