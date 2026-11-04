import * as Tone from "tone";
import { pitchIndexAt } from "../scales";
import { CHROMATIC, layout, MARGIN_LEFT, MARGIN_RIGHT, type Movement, type MovementContext, pendingQueue, rand, random, scheduler, type Sonata, staffPen, TICK } from "./movement";
import { musicLeft } from "./staff";

// モートン・フェルドマンがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// フェルドマンの後期の作品は、ごく弱い音で、短い型を何度か繰り返しては少しだけ変え、別の型へ移る。盛り上がりも展開もなく、
// ときどき前に聞いた型がそのまま戻ってきて、記憶を揺さぶる。型の長さがそろわないので、繰り返しても拍子が定まらない。
// I.   不揃いな反復: 長さの違う短い型を、少しずつ変えながら数回ずつ繰り返す。前の型がときどき戻り、最後は最初の型に帰る
// II.  和音の陰影: 広く散らばった柔らかい和音を長く置き、繰り返すたびに 1 音だけ半音ずらす。和音はだんだん薄くなり、最後は 1 音になる
// III. 記憶の層: 左手が近い音どうしの小さな型を刻み続け、その上に、右手の型が長さを違えて現れては消える
// 時刻はすべて音の時計で持ち、テンポの設定で 1 拍の長さが決まる。音はどれもごく弱い
// ルバートは、気づくか気づかないかくらいに、型を繰り返すたびに速さをわずかに変える（1 音ごとのずれや和音の崩しは、設定の「揺らぎ」が受け持つ）。
// 揺れは毎回違う（曲の中身は Op. の番号で決まるが、揺れ方は決まらない）。III の左手は、時計として揺らさない

const PACE = 0.015; // 型を 1 回鳴らすときの、拍の長さの揺れ（倍率の幅）
const pace = () => 1 + random(-PACE, PACE);

// 半音階での音程を、今の音階の段数に直す（半音階以外を選んだときも、音域の広がりがおおよそ保たれる）
const steps = (ctx: MovementContext, semitones: number) => Math.round((semitones * layout(ctx, 12).perOctave) / 12);

// --- 画面: 音は、型（小節）の中の位置を横に、高さを縦にして置く。同じ型を繰り返すと、同じ場所が重なって明るくなる ---

type Mark = { time: number; index: number; x: number; seconds: number; layer: number };
const FADE = 16;
const PAD = 16; // 音部記号・調号と、いちばん左の音符のあいだ（px）

function markView(ctx: MovementContext) {
  let marks: Mark[] = [];
  return {
    add: (m: Mark) => () => marks.push(m),
    clear: () => (marks = []),
    draw(g: CanvasRenderingContext2D, width: number, height: number) {
      const now = Tone.now();
      marks = marks.filter((m) => now - m.time < FADE);
      // 音符は音部記号と調号の右に、臨時記号が入るだけの余白を空けて置く
      const pen = staffPen(ctx, height);
      const from = pen.left + PAD;
      const span = width - from - MARGIN_RIGHT;
      for (const m of marks) {
        const age = now - m.time;
        const ringing = Math.max(0, 1 - age / m.seconds);
        const fade = 1 - age / FADE;
        const x = from + m.x * span;
        const { y, index, octave } = pen.shown(m.index);
        g.fillStyle = m.layer === 0 ? `hsla(250, 25%, 80%, ${(0.08 + 0.35 * ringing) * fade})` : `hsla(35, 35%, 80%, ${(0.08 + 0.35 * ringing) * fade})`;
        pen.note(g, x, y, index, 4 + 8 * ringing);
        pen.ottava(g, x, y, octave);
      }
    },
  };
}

// クリック: その高さに、ごく弱い音を 1 つと、長 7 度上の音を少し遅れて置く
function softAt(ctx: MovementContext, queue: ReturnType<typeof pendingQueue>, view: ReturnType<typeof markView>, x: number, y: number, width: number, height: number) {
  const h = layout(ctx, 12);
  const index = Math.min(Math.max(pitchIndexAt(y, height, h.count), 0), h.count - 1);
  const time = Tone.now() + 0.02;
  const from = Math.max(MARGIN_LEFT, musicLeft()) + PAD;
  const fx = Math.min(Math.max((x - from) / (width - from - MARGIN_RIGHT), 0), 1);
  queue.add({ time, index, velocity: 0.16, seconds: 4, onPlay: view.add({ time, index, x: fx, seconds: 4, layer: 1 }) });
  const upper = h.place(index + steps(ctx, 11));
  queue.add({ time: time + 0.35, ...upper, velocity: 0.12, seconds: 4 });
}

// --- 型: 長さ（拍）と、その中の位置に置いた 1〜2 音のいくつかの出来事 ---

type Event = { at: number; notes: number[] }; // notes は音高の位置（画面の外は place で直す）
type Pattern = { length: number; events: Event[] };

const LENGTHS = [3, 4, 5, 5, 6, 7];
const DYADS = [1, 11, 13, 6, 10, 14, 23]; // 2 音を重ねるときの音程（半音）。短 2 度・長 7 度・短 9 度など、柔らかくぶつかる音程

function newPattern(ctx: MovementContext, centre: number, spread: number): Pattern {
  const length = LENGTHS[Math.floor(rand() * LENGTHS.length)];
  const count = 1 + Math.floor(rand() * 3);
  const slots = Array.from({ length: length * 2 }, (_, i) => i / 2).sort(() => rand() - 0.5).slice(0, count).sort((a, b) => a - b);
  const events = slots.map((at) => {
    const low = Math.round(centre + random(-spread, spread));
    const notes = rand() < 0.5 ? [low] : [low, low + steps(ctx, DYADS[Math.floor(rand() * DYADS.length)])];
    return { at, notes };
  });
  return { length, events };
}

// 繰り返すたびの小さな変化: どれか 1 つの出来事の、1 音を半音ずらすか、位置を半拍ずらすか、オクターブを移す
function vary(ctx: MovementContext, p: Pattern): Pattern {
  const events = p.events.map((e) => ({ at: e.at, notes: [...e.notes] }));
  const e = events[Math.floor(rand() * events.length)];
  const roll = rand();
  if (roll < 0.5) {
    const i = Math.floor(rand() * e.notes.length);
    e.notes[i] += rand() < 0.5 ? -1 : 1;
  } else if (roll < 0.8) e.at = Math.min(Math.max(e.at + (rand() < 0.5 ? -0.5 : 0.5), 0), p.length - 0.5);
  else {
    const i = Math.floor(rand() * e.notes.length);
    e.notes[i] += (rand() < 0.5 ? -1 : 1) * layout(ctx, 12).perOctave;
  }
  return { length: p.length, events };
}

// 型を 1 回（1 小節）鳴らす
function playPattern(
  ctx: MovementContext,
  queue: ReturnType<typeof pendingQueue>,
  view: ReturnType<typeof markView>,
  p: Pattern,
  at: number,
  beat: number,
  velocity: number,
  layer: number,
) {
  const h = layout(ctx, 12);
  for (const e of p.events) {
    const time = at + e.at * beat;
    e.notes.forEach((n, i) => {
      const placed = h.place(n);
      const v = velocity * (i === 0 ? 1 : 0.85) * random(0.9, 1.1);
      const seconds = beat * random(3, 5);
      queue.add({ time, ...placed, velocity: v, seconds, onPlay: view.add({ time, index: n, x: e.at / p.length, seconds, layer }) });
    });
  }
}

// --- I. 不揃いな反復 ---

const FIRST_RETURN = 0.94; // ここを過ぎたら、最初の型に帰って終える

const repetitions: Movement = {
  title: { ja: "I. 不揃いな反復", en: "I. Irregular repetitions" },
  duration: 300,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const beat = () => 60 / ctx.bpm();
    const h0 = layout(ctx, 12);
    const memory: Pattern[] = [newPattern(ctx, h0.middle, h0.perOctave)]; // 一度鳴らした型（変える前の形）
    let playing = memory[0];
    let repeatsLeft = 2 + Math.floor(rand() * 4);
    let nextAt = startAt + 0.5;
    let returning = false;
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending || nextAt >= time + TICK) return;
      const progress = (nextAt - startAt) / repetitions.duration;
      const b = beat();

      if (repeatsLeft === 0) {
        if (returning || progress > 1.15) {
          ending = true;
          endAt = nextAt + 6;
        } else if (progress >= FIRST_RETURN) {
          // 終わり: 最初の型に帰り、変えずに 2 回鳴らして終える
          returning = true;
          playing = memory[0];
          repeatsLeft = 2;
        } else {
          // 型のあいだに、ときどき沈黙の小節を置く
          if (rand() < 0.3) nextAt += (b * random(2, 5)) / Math.sqrt(ctx.density());
          // 前に聞いた型が戻ってくる割合は、時間がたつにつれて少しずつ上がる
          const recall = memory.length > 1 && rand() < 0.15 + 0.3 * progress;
          const h = layout(ctx, 12);
          playing = recall ? memory[Math.floor(rand() * (memory.length - 1))] : newPattern(ctx, h.middle + Math.round(random(-0.5, 0.5) * h.perOctave), h.perOctave);
          if (!recall) memory.push(playing);
          repeatsLeft = 2 + Math.floor(rand() * 4);
        }
        return;
      }

      // 型の 1 回目はそのまま、2 回目からはときどき少し変える（最初の型に帰ったときは変えない）
      const paced = b * pace();
      playPattern(ctx, queue, view, playing, nextAt, paced, 0.17, 0);
      nextAt += playing.length * paced;
      repeatsLeft--;
      if (!returning && rand() < 0.5) playing = vary(ctx, playing);
    });

    return {
      pointer: (x, y, height) => !ending && softAt(ctx, queue, view, x, y, window.innerWidth, height),
      draw: (g, width, height) => view.draw(g, width, height),
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
        queue.clear();
        view.clear();
      },
    };
  },
};

// --- II. 和音の陰影 ---

const CHORD_SPACING = [7, 10, 11, 13, 14, 15, 17]; // 和音の隣どうしの音程（半音）。広く散らばる

const shadedChords: Movement = {
  title: { ja: "II. 和音の陰影", en: "II. Shaded chords" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const beat = () => 60 / ctx.bpm();
    let nextAt = startAt + 0.5;
    let chord: number[] = [];
    let repeatsLeft = 0;
    let ending = false;

    // 和音の音の数は、5 音から始めて少しずつ減り、終わり近くでは 2 音になる
    const newChord = (size: number) => {
      const h = layout(ctx, 12);
      const notes = [Math.round(random(0.05, 0.3) * h.count)];
      while (notes.length < size) notes.push(notes.at(-1)! + steps(ctx, CHORD_SPACING[Math.floor(rand() * CHORD_SPACING.length)]));
      return notes;
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending || nextAt >= time + TICK) return;
      const progress = (nextAt - startAt) / shadedChords.duration;
      const b = beat();
      const h = layout(ctx, 12);
      const x = ((nextAt - startAt) % 40) / 40;

      // 終わり: 低い 1 音を長く置く
      if (progress >= 0.93) {
        ending = true;
        const index = Math.round(0.15 * h.count);
        queue.add({ time: nextAt, index, velocity: 0.15, seconds: 10, onPlay: view.add({ time: nextAt, index, x, seconds: 10, layer: 0 }) });
        endAt = nextAt + 10;
        return;
      }

      if (repeatsLeft === 0) {
        // 和音の組のあいだに、ときどき低い 1 音を 3 回、鐘のように鳴らす
        if (chord.length && rand() < 0.25) {
          const index = Math.round(random(0.05, 0.2) * h.count);
          for (let i = 0; i < 3; i++) {
            const at = nextAt + i * b * 3;
            queue.add({ time: at, index, velocity: 0.12, seconds: b * 4, onPlay: view.add({ time: at, index, x: (((at - startAt) % 40) / 40), seconds: b * 4, layer: 1 }) });
          }
          nextAt += b * random(10, 13);
        }
        chord = newChord(Math.max(2, Math.round(5 - 3 * progress)));
        repeatsLeft = 2 + Math.floor(rand() * 3);
        return;
      }

      // 和音を長く置く。繰り返すたびに 1 音だけ半音ずらす（陰影が変わる）
      const hold = b * random(4, 7);
      chord.forEach((n, i) => {
        const placed = h.place(n);
        const velocity = 0.15 * (i === chord.length - 1 ? 0.8 : 1) * random(0.9, 1.1);
        queue.add({ time: nextAt, ...placed, velocity, seconds: hold * 1.3, onPlay: view.add({ time: nextAt, index: n, x, seconds: hold * 1.3, layer: 0 }) });
      });
      nextAt += hold + (b * random(2, 6)) / Math.sqrt(ctx.density());
      repeatsLeft--;
      const i = Math.floor(rand() * chord.length);
      chord = chord.map((n, j) => (j === i ? n + (rand() < 0.5 ? -1 : 1) : n));
    });

    return {
      pointer: (x, y, height) => !ending && softAt(ctx, queue, view, x, y, window.innerWidth, height),
      draw: (g, width, height) => view.draw(g, width, height),
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
        queue.clear();
        view.clear();
      },
    };
  },
};

// --- III. 記憶の層 ---

const memoryLayers: Movement = {
  title: { ja: "III. 記憶の層", en: "III. Layers of memory" },
  duration: 300,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const step = () => 30 / ctx.bpm(); // 左手は 8 分音符
    const h0 = layout(ctx, 12);

    // 左手: 近い音どうしの 3〜4 音の小さな型。何周かするたびに 1 音を半音ずらし、ときどき型の長さを変える
    const low = Math.round(0.3 * h0.count);
    let figure = [low, low + 1, low, low + steps(ctx, 3)];
    let figureStep = 0;
    let cyclesLeft = 6 + Math.floor(rand() * 7);
    let leftAt = startAt + 0.5;

    // 右手: I と同じ型を、高めの音域で。左手と長さがそろわないので、重なり方が毎回変わる
    const memory: Pattern[] = [];
    let right: Pattern | null = null;
    let rightRepeats = 0;
    let rightAt = startAt + 0.5 + 0.12 * memoryLayers.duration;
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = layout(ctx, 12);

      while (leftAt < time + TICK) {
        const progress = (leftAt - startAt) / memoryLayers.duration;
        // 終わり: 右手が抜けたあと、左手の型の頭で、最初の音を長く置いて終える
        if (progress >= 0.95 && figureStep % figure.length === 0) {
          ending = true;
          queue.add({ time: leftAt, index: figure[0], velocity: 0.14, seconds: 8, onPlay: view.add({ time: leftAt, index: figure[0], x: 0, seconds: 8, layer: 0 }) });
          endAt = leftAt + 8;
          return;
        }
        const position = figureStep % figure.length;
        const index = figure[position];
        const velocity = (position === 0 ? 0.15 : 0.12) * random(0.9, 1.1);
        const seconds = step() * 2.5;
        const at = leftAt;
        queue.add({ time: at, index, velocity, seconds, onPlay: view.add({ time: at, index, x: position / figure.length, seconds, layer: 0 }) });
        figureStep++;
        leftAt += step();
        if (figureStep % figure.length === 0 && --cyclesLeft === 0) {
          cyclesLeft = 6 + Math.floor(rand() * 7);
          if (rand() < 0.25) figure = figure.length === 4 ? figure.slice(0, 3) : [...figure, figure[1]];
          const i = Math.floor(rand() * figure.length);
          figure = figure.map((n, j) => (j === i ? Math.min(Math.max(n + (rand() < 0.5 ? -1 : 1), low - 3), low + 6) : n));
          figureStep = 0;
        }
      }

      if (rightAt >= time + TICK) return;
      const progress = (rightAt - startAt) / memoryLayers.duration;
      const b = step() * 2;
      // 右手は終わり近くで抜け、左手だけが残る
      if (progress >= 0.85) {
        rightAt = Infinity;
        return;
      }
      if (rightRepeats === 0) {
        // 型のあいだに沈黙を置く。中ほどで短く、始めと終わりで長い
        const thin = 1 - Math.sin(Math.PI * progress);
        rightAt += (b * random(2, 6) * (1 + 2 * thin)) / Math.sqrt(ctx.density());
        const recall = memory.length > 1 && rand() < 0.3;
        right = recall ? memory[Math.floor(rand() * memory.length)] : newPattern(ctx, h.middle + Math.round(0.6 * h.perOctave), h.perOctave * 0.7);
        if (!recall) memory.push(right);
        rightRepeats = 2 + Math.floor(rand() * 4);
        return;
      }
      const paced = b * pace();
      playPattern(ctx, queue, view, right!, rightAt, paced, 0.16, 1);
      rightAt += right!.length * paced;
      rightRepeats--;
      if (rand() < 0.4) right = vary(ctx, right!);
    });

    return {
      pointer: (x, y, height) => !ending && softAt(ctx, queue, view, x, y, window.innerWidth, height),
      draw: (g, width, height) => view.draw(g, width, height),
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
        queue.clear();
        view.clear();
      },
    };
  },
};

export const feldman: Sonata = {
  id: "feldman",
  composer: { ja: "モートン・フェルドマン", en: "Morton Feldman" },
  initials: "M.F.",
  // 半音階。柔らかくぶつかる音程（短 2 度・長 7 度・短 9 度）を自由に使う
  scale: CHROMATIC,
  root: "C", // 主音。半音階なので、調号のない C
  movements: [repetitions, shadedChords, memoryLayers],
};
