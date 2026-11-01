import * as Tone from "tone";
import { pitchIndexAt } from "../scales";
import { layout, type Layout, MARGIN_LEFT, MARGIN_RIGHT, type Movement, type MovementContext, pendingQueue, rand, random, scheduler, type Sonata, TICK, yOf } from "./movement";

// オリヴィエ・メシアンがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// I.   鳥の歌: 鳥ごとに決まった鳴き方（同じ音の連打、トリル、前打音つきのさえずり、駆け下り、跳ねる呼び声）があり、
//      夜明けのように 1 羽ずつ加わって鳴き交わし、やがて去っていく。ときどき低い所で、森のような柔らかい和音が響く
// II.  リズムの登場人物: 逆から読んでも同じになるリズム（例えば 3 2 5 2 3）を、3 人の登場人物が同時に繰り返す。
//      1 人は真ん中の音が 1 つずつ伸び、1 人は縮み、1 人は変わらない。しばらくごとに、全員の和音が 1 段ずれる
// III. 音価と強さの旋法: 鍵ごとに長さと強さと弾き方が決まっていて、どの鍵もいつも同じ長さ・強さで鳴る。
//      高・中・低の 3 つの声が、自分の音域の鍵を選び続けるだけで、リズムと強弱が音の高さから生まれる

// --- 画面: 鳴った音が右端から左へ流れる。上には、楽章ごとの仕組み（鳥・リズム・鍵ごとの値）を出す ---

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
        g.fillStyle = `hsla(${m.hue}, 65%, ${60 + 18 * ringing}%, ${(0.2 + 0.6 * ringing) * fade})`;
        g.beginPath();
        g.arc(x, y, 1.5 + 5 * m.velocity + 2 * ringing, 0, Math.PI * 2);
        g.fill();
      }
    },
  };
}

type Queue = ReturnType<typeof pendingQueue>;
type View = ReturnType<typeof markView>;

function note(h: Layout, queue: Queue, view: View, index: number, time: number, velocity: number, seconds: number, hue: number) {
  queue.add({ time, ...h.place(index), velocity, seconds, onPlay: view.add({ time, index, hue, seconds, velocity }) });
}

const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
const clamp = (x: number, min: number, max: number) => Math.min(Math.max(x, min), max);

// 和音の形（音階の段で数える）。移調の限られた旋法の第 2 番では、7 の和音に短 9 度が乗ったような、きらびやかな響きになる
const SHAPES = [
  [0, 3, 5, 7, 9],
  [0, 2, 5, 8, 10],
  [0, 3, 6, 9, 11],
  [0, 1, 4, 7, 10],
];
const chord = (h: Layout, queue: Queue, view: View, base: number, shape: number[], time: number, velocity: number, seconds: number, hue: number) => {
  for (const s of shape) note(h, queue, view, base + s, time, velocity * random(0.9, 1.05), seconds, hue);
};

const clickIndex = (h: Layout, y: number, height: number) => clamp(pitchIndexAt(y, height, h.count), 0, h.count - 1);

// --- I. 鳥の歌 ---

type Call = { offset: number; gap: number; velocity: number };
type Bird = { calls: Call[]; register: number; hue: number; enter: number; leave: number; nextAt: number; sangAt: number };

// 鳥ごとの鳴き方。offset は鳥の音域からの段、gap は次の音までの秒
function newCalls(): Call[] {
  const kind = pick(["repeat", "trill", "chirp", "run", "call"]);
  if (kind === "repeat") {
    // 同じ音の連打。だんだん速くなり、最後を強く
    const n = 4 + Math.floor(rand() * 5);
    return Array.from({ length: n }, (_, i) => ({ offset: 0, gap: 0.12 - (0.06 * i) / n, velocity: i === n - 1 ? 0.45 : 0.3 }));
  }
  if (kind === "trill") {
    const n = 8 + Math.floor(rand() * 7);
    const width = pick([1, 1, 2]);
    return Array.from({ length: n }, (_, i) => ({ offset: i % 2 ? width : 0, gap: 0.055, velocity: 0.28 }));
  }
  if (kind === "chirp") {
    // 前打音 2 つと、強い音。2 回繰り返す
    const top = 2 + Math.floor(rand() * 3);
    const one = [
      { offset: top, gap: 0.04, velocity: 0.22 },
      { offset: top - 1, gap: 0.04, velocity: 0.25 },
      { offset: 0, gap: 0.28, velocity: 0.42 },
    ];
    return [...one, ...one];
  }
  if (kind === "run") {
    const n = 5 + Math.floor(rand() * 4);
    let offset = 4;
    return Array.from({ length: n }, () => {
      const call = { offset, gap: 0.05, velocity: 0.3 };
      offset -= pick([1, 1, 2]);
      return call;
    });
  }
  // 跳ねる呼び声: 高い音と低い音を、2〜3 回
  const leap = 3 + Math.floor(rand() * 4);
  return Array.from({ length: 2 + Math.floor(rand() * 2) }, () => [
    { offset: 0, gap: 0.16, velocity: 0.38 },
    { offset: -leap, gap: 0.45, velocity: 0.3 },
  ]).flat();
}

const birdsong: Movement = {
  title: { ja: "I. 鳥の歌", en: "I. Birdsong" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const h0 = layout(ctx, 8);
    // 5 羽。1 羽ずつ加わり、終わり近くに去っていく（最初の鳥が最後まで残る）
    const birds: Bird[] = Array.from({ length: 5 }, (_, i) => ({
      calls: newCalls(),
      register: Math.round(h0.perOctave * random(0.4, 2)),
      hue: [50, 140, 190, 320, 20][i],
      enter: i * 0.1,
      leave: i === 0 ? 0.97 : 0.7 + i * 0.05,
      nextAt: startAt + 0.5 + i * 0.1 * birdsong.duration + random(0, 3),
      sangAt: -Infinity,
    }));
    let forestAt = startAt + random(4, 8);
    let ending = false;

    const sing = (h: Layout, bird: Bird, at: number, scale = 1) => {
      // 鳴くたびに少し変える: ときどき 1 段ずらし、ときどき音を 1 つ抜く
      const shift = rand() < 0.3 ? pick([-1, 1]) : 0;
      let time = at;
      for (const c of bird.calls) {
        if (rand() > 0.08) note(h, queue, view, h.centre + bird.register + c.offset + shift, time, c.velocity * scale * random(0.9, 1.1), 0.25, bird.hue);
        time += c.gap;
      }
      return time;
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = layout(ctx, 8);
      const now = time + TICK;
      if (now - startAt >= birdsong.duration) {
        // 終わり: 森の和音を低く長く置く
        ending = true;
        chord(h, queue, view, h.lowRoot, SHAPES[0], now + 0.5, 0.14, 7, 260);
        endAt = now + 8;
        return;
      }
      for (const bird of birds) {
        if (bird.nextAt >= now) continue;
        const progress = (bird.nextAt - startAt) / birdsong.duration;
        if (progress < bird.enter || progress >= bird.leave) {
          bird.nextAt += 2;
          continue;
        }
        const end = sing(h, bird, bird.nextAt);
        const at = bird.nextAt;
        Tone.getDraw().schedule(() => (bird.sangAt = at), at);
        bird.nextAt = end + random(1.5, 5) / Math.max(ctx.density(), 0.3);
      }
      // 森: ときどき低い所で、柔らかい和音が長く響く
      if (forestAt < now) {
        chord(h, queue, view, h.lowRoot + Math.floor(rand() * h.perOctave), pick(SHAPES), forestAt, 0.12, 6, 260);
        forestAt += random(12, 22);
      }
    });

    return {
      pointer: (_x, y, height) => {
        if (ending) return;
        // クリック: その高さで、前打音つきのさえずりを 1 つ
        const h = layout(ctx, 8);
        const index = clickIndex(h, y, height);
        const time = Tone.now() + 0.02;
        note(h, queue, view, index + 2, time, 0.2, 0.2, 60);
        note(h, queue, view, index + 1, time + 0.04, 0.22, 0.2, 60);
        note(h, queue, view, index, time + 0.08, 0.38, 0.4, 60);
      },
      draw: (g, width, height) => {
        view.draw(g, width, height);
        // 上に鳥を 1 羽ずつ点で出す。鳴いたところが明るい
        const now = Tone.now();
        birds.forEach((bird, i) => {
          const lit = Math.max(0, 1 - (now - bird.sangAt) / 1.2);
          g.fillStyle = `hsla(${bird.hue}, 65%, ${55 + 25 * lit}%, ${0.2 + 0.7 * lit})`;
          g.beginPath();
          g.arc(MARGIN_LEFT + 6 + i * 20, 73, 4 + 3 * lit, 0, Math.PI * 2);
          g.fill();
        });
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

// --- II. リズムの登場人物 ---

// 登場人物: 逆から読んでも同じリズム（16 分音符いくつ分かの並び）を繰り返す。grow は真ん中が 1 つずつ伸び、shrink は縮み、keep は変わらない
type Character = { mode: "grow" | "shrink" | "keep"; first: number[]; cell: number[]; position: number; at: number; base: number; shape: number[]; hue: number; velocity: number };

const characters: Movement = {
  title: { ja: "II. リズムの登場人物", en: "II. Rhythmic characters" },
  duration: 220,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const unit = () => 15 / ctx.bpm();
    const h0 = layout(ctx, 8);
    const make = (mode: Character["mode"], first: number[], base: number, shape: number[], hue: number, velocity: number): Character => ({
      mode,
      first,
      cell: [...first],
      position: 0,
      at: startAt + 0.5,
      base,
      shape,
      hue,
      velocity,
    });
    const cast = [
      make("grow", pick([[3, 2, 5, 2, 3], [2, 3, 4, 3, 2], [3, 1, 4, 1, 3]]), h0.centre + Math.floor(h0.perOctave * 0.6), pick(SHAPES).slice(0, 4), 45, 0.28),
      make("shrink", pick([[4, 1, 9, 1, 4], [3, 2, 8, 2, 3], [5, 2, 7, 2, 5]]), h0.lowRoot, [0, 5, 9], 230, 0.3),
      make("keep", pick([[2, 3, 2], [3, 1, 3], [2, 1, 2, 1, 2]]), h0.centre - 2, [0, 2], 320, 0.22),
    ];
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = layout(ctx, 8);
      const u = unit();
      for (const c of cast) {
        while (c.at < time + TICK) {
          const elapsed = c.at - startAt;
          if (elapsed >= characters.duration) {
            // 終わり: 全員がそろうのを待たず、最後に 3 人の和音を重ねて長く置く
            ending = true;
            const at = Math.max(...cast.map((x) => x.at));
            for (const x of cast) chord(h, queue, view, x.base, x.shape, at, x.velocity * 1.2, 6, x.hue);
            endAt = at + 7;
            return;
          }
          // しばらくごとに、全員の和音が 1 段ずれる（旋法の移調）
          const shift = Math.floor(elapsed / 45);
          const value = c.cell[c.position];
          // keep は、同じ形のまま 1 段ずつ上下する短い旋律
          const move = c.mode === "keep" ? [0, 1, 2, 1, 0, -1][c.position % 6] : 0;
          chord(h, queue, view, c.base + shift + move, c.shape, c.at, c.velocity * (c.position === Math.floor(c.cell.length / 2) ? 1.2 : 1), value * u * 1.1, c.hue);
          c.at += value * u;
          c.position++;
          if (c.position < c.cell.length) continue;
          c.position = 0;
          const mid = Math.floor(c.cell.length / 2);
          if (c.mode === "grow") c.cell[mid] = c.cell[mid] >= 14 ? c.first[mid] : c.cell[mid] + 1;
          if (c.mode === "shrink") c.cell[mid] = c.cell[mid] <= 1 ? c.first[mid] : c.cell[mid] - 1;
        }
      }
    });

    return {
      pointer: (_x, y, height) => {
        if (ending) return;
        // クリック: その高さに、きらびやかな和音を 1 つ
        const h = layout(ctx, 8);
        chord(h, queue, view, clickIndex(h, y, height), SHAPES[0].slice(0, 4), Tone.now() + 0.02, 0.26, 1.5, 60);
      },
      draw: (g, width, height) => {
        view.draw(g, width, height);
        // 上に 3 人のリズムを 1 段ずつ、長さに比べた箱で出す（今の音が明るい）
        const scale = 6;
        g.font = "12px system-ui, sans-serif";
        g.textAlign = "left";
        cast.forEach((c, row) => {
          const y = 62 + row * 13;
          g.fillStyle = "rgba(255, 255, 255, 0.5)";
          g.fillText({ grow: "↗", shrink: "↘", keep: "→" }[c.mode], MARGIN_LEFT, y + 9);
          let x = MARGIN_LEFT + 18;
          c.cell.forEach((value, i) => {
            const current = i === (c.position + c.cell.length - 1) % c.cell.length;
            g.fillStyle = current ? `hsla(${c.hue}, 65%, 70%, 0.85)` : `hsla(${c.hue}, 40%, 60%, 0.25)`;
            g.fillRect(x, y, value * scale - 2, 9);
            x += value * scale;
          });
        });
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

// --- III. 音価と強さの旋法 ---

type KeyValue = { units: number; velocity: number; staccato: boolean };
const INTENSITIES = [0.05, 0.1, 0.16, 0.23, 0.3, 0.4, 0.5]; // ppp〜ff
const VOICE_HUES = [40, 170, 280];

const valuesMode: Movement = {
  title: { ja: "III. 音価と強さの旋法", en: "III. Mode of durations and intensities" },
  duration: 220,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const unit = () => 15 / ctx.bpm();
    // 鍵ごとの長さ（16 分音符 1〜12 個）・強さ・弾き方。画面の外（下と上に 1 オクターブずつ）の鍵にも決めておく
    const h0 = layout(ctx, 8);
    const from = -h0.perOctave;
    const to = h0.count + h0.perOctave;
    const values = new Map<number, KeyValue>();
    for (let i = from; i < to; i++) values.set(i, { units: 1 + Math.floor(rand() * 12), velocity: pick(INTENSITIES), staccato: rand() < 0.3 });
    const valueOf = (index: number) => values.get(clamp(index, from, to - 1))!;
    // 3 つの声: 音域を低・中・高に 3 つに分け、それぞれ自分の音域の鍵だけを選ぶ。高い声から始まり、低い声から去る
    const third = (to - from) / 3;
    const voices = [0, 1, 2].map((v) => ({
      low: Math.round(from + v * third),
      high: Math.round(from + (v + 1) * third),
      enter: [0.25, 0.12, 0][v],
      leave: [0.75, 0.88, 1][v],
      at: startAt + 0.5,
      last: NaN,
      hue: VOICE_HUES[v],
    }));
    const lit = new Map<number, number>(); // 鍵ごとの、最後に鳴った時刻（画面のため）
    let ending = false;

    const play = (h: Layout, index: number, at: number, hue: number) => {
      const v = valueOf(index);
      const seconds = v.staccato ? 0.1 : v.units * unit() * 1.05;
      note(h, queue, view, index, at, v.velocity, seconds, hue);
      Tone.getDraw().schedule(() => lit.set(index, at), at);
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = layout(ctx, 8);
      const u = unit();
      for (const voice of voices) {
        while (voice.at < time + TICK) {
          const progress = (voice.at - startAt) / valuesMode.duration;
          if (progress >= 1) {
            // 終わり: いちばん低い鍵を 1 つ、長く
            ending = true;
            const at = Math.max(...voices.map((x) => x.at));
            note(h, queue, view, from, at, 0.3, 5, VOICE_HUES[0]);
            endAt = at + 5;
            return;
          }
          if (progress < voice.enter || progress >= voice.leave) {
            voice.at += 1;
            continue;
          }
          let index = voice.low + Math.floor(rand() * (voice.high - voice.low));
          if (index === voice.last) index = voice.low + ((index - voice.low + 1) % (voice.high - voice.low));
          voice.last = index;
          play(h, index, voice.at, voice.hue);
          // 次の音は、この鍵の長さのあと。ときどき短く休む
          voice.at += valueOf(index).units * u + (rand() < 0.15 ? (1 + Math.floor(rand() * 4)) * u : 0);
        }
      }
    });

    return {
      pointer: (_x, y, height) => {
        if (ending) return;
        // クリック: その鍵を、決まった長さと強さで鳴らす
        const h = layout(ctx, 8);
        play(h, clickIndex(h, y, height), Tone.now() + 0.02, 60);
      },
      draw: (g, width, height) => {
        view.draw(g, width, height);
        // 上に鍵ごとの値を出す: 棒の高さが長さ、濃さが強さ、点が短く切る音。鳴った鍵が光る
        const now = Tone.now();
        const span = Math.min(width - MARGIN_LEFT - MARGIN_RIGHT, (to - from) * 8);
        const w = span / (to - from);
        for (let i = from; i < to; i++) {
          const v = valueOf(i);
          const x = MARGIN_LEFT + (i - from) * w;
          const glow = Math.max(0, 1 - (now - (lit.get(i) ?? -Infinity)) / 0.8);
          const bar = 3 + v.units * 2;
          g.fillStyle = `rgba(255, ${230 - 60 * glow}, ${200 - 120 * glow}, ${0.12 + v.velocity * 0.9 + 0.5 * glow})`;
          g.fillRect(x, 88 - bar, Math.max(w - 1.5, 1), bar);
          if (v.staccato) g.fillRect(x + w / 2 - 1, 91, 2, 2);
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

export const messiaen: Sonata = {
  id: "messiaen",
  composer: { ja: "オリヴィエ・メシアン", en: "Olivier Messiaen" },
  initials: "O.M.",
  // 移調の限られた旋法の第 2 番（半音と全音が交互に並ぶ 8 音の音階）。3 回移調すると元に戻る
  scale: { id: "messiaen-mode-2", group: "", name: { ja: "移調の限られた旋法 第 2 番", en: "Mode of limited transposition 2" }, steps: [0, 1, 3, 4, 6, 7, 9, 10] },
  movements: [birdsong, characters, valuesMode],
};
