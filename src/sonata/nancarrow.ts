import * as Tone from "tone";
import { pitchIndexAt } from "../scales";
import { type FlowMark, flowView, layout, MARGIN_LEFT, MARGIN_RIGHT, type Movement, type MovementContext, pendingQueue, rand, random, scheduler, type Sonata, TICK } from "./movement";

// コンロン・ナンカロウがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// ナンカロウは自動ピアノのために、人の手では弾けない速さと、テンポの違う声部の重なりを書いた。
// I.   加速と減速: 高い声部はゆっくり始めて速くなり続け、低い声部は速く始めて遅くなり続ける。中ほどで速さが入れ替わる
// II.  ブギウギの層: 左手のブギウギの型に、テンポの違う右手の型（3:2、5:4、7:4）が重なっていき、また抜けていく
// III. 収束するカノン: 同じ旋律を 4 つの声部が違う速さ（1・√2・2・2√2 倍）で弾く。遅い声部から先に始め、最後の音で全員がそろう
// 時刻はすべて音の時計で持つ

// --- 画面: 鳴った音が右端から左へ流れる。声部ごとに色を変える ---

const HUES = [25, 190, 310, 95];
type VoiceMark = FlowMark & { voice: number };
const WINDOW = 12;

const markView = (ctx: MovementContext) =>
  flowView<VoiceMark>(ctx, WINDOW, (g, m, x, y, ringing, fade, span) => {
    const length = Math.max(2, (m.seconds / WINDOW) * span * 0.6);
    g.fillStyle = m.voice < 0 ? `rgba(255, 255, 255, ${(0.3 + 0.6 * ringing) * fade})` : `hsla(${HUES[m.voice % HUES.length]}, 70%, ${55 + 25 * ringing}%, ${(0.3 + 0.6 * ringing) * fade})`;
    g.fillRect(x, y - 1.5 - 2 * m.velocity, length, 3 + 4 * m.velocity);
  });

// クリック: その高さから、自動ピアノのような速い駆け上がりを鳴らす
function runAt(ctx: MovementContext, queue: ReturnType<typeof pendingQueue>, view: ReturnType<typeof markView>, y: number, height: number) {
  const count = ctx.pitches().length;
  const from = Math.min(Math.max(pitchIndexAt(y, height, count), 0), count - 1);
  const now = Tone.now() + 0.02;
  for (let i = 0; i < 7; i++) {
    const time = now + i * 0.035;
    const index = from + i;
    const velocity = 0.25 + 0.03 * i;
    queue.add({ time, index, velocity, seconds: 0.4, onPlay: view.add({ time, index, voice: -1, seconds: 0.4, velocity }) });
  }
}

// --- I. 加速と減速 ---

const RATE_LOW = 1.5; // 1 秒あたりの音の数（テンポ 132 のとき）
const RATE_HIGH = 16;

type Runner = { nextAt: number; index: number; direction: number; low: number; high: number; accelerating: boolean };

const acceleration: Movement = {
  title: { ja: "I. 加速と減速", en: "I. Acceleration and deceleration" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const { count } = layout(ctx);
    const half = Math.floor(count / 2);
    // 高い声部は加速し、低い声部は減速する
    const runners: Runner[] = [
      { nextAt: startAt + 0.5, index: count - 3, direction: -1, low: half, high: count - 1, accelerating: true },
      { nextAt: startAt + 0.5, index: 2, direction: 1, low: 0, high: half, accelerating: false },
    ];
    // 速さは指数で変える（耳には一定の割合で速くなって聞こえる）。中ほどで 2 つの声部の速さが等しくなる
    const rateOf = (r: Runner, progress: number) => {
      const p = Math.min(Math.max(progress, 0), 1);
      return RATE_LOW * (RATE_HIGH / RATE_LOW) ** (r.accelerating ? p : 1 - p) * (ctx.bpm() / 132);
    };
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      runners.forEach((r, voice) => {
        while (r.nextAt < time + TICK) {
          const at = r.nextAt;
          const progress = (at - startAt) / acceleration.duration;
          if (progress >= 1) {
            ending = true;
            break;
          }
          const rate = rateOf(r, progress);
          // 速いほど 1 音は弱く、同じ向きへ駆け続けやすい。遅いうちは跳躍も混ぜる
          const fast = Math.log(rate / RATE_LOW) / Math.log(RATE_HIGH / RATE_LOW);
          const velocity = (0.5 - 0.22 * fast) * (0.8 + 0.4 * Math.sin(Math.PI * progress));
          const seconds = Math.min(1.5 / rate, 1.6);
          const index = r.index;
          queue.add({ time: at, index, velocity, seconds, onPlay: view.add({ time: at, index, voice, seconds, velocity }) });
          if (rand() > 0.6 + 0.3 * fast) r.direction = -r.direction;
          const step = rand() < 0.15 * (1 - fast) ? Math.floor(random(2, 5)) : 1;
          r.index += r.direction * step;
          if (r.index > r.high || r.index < r.low) {
            r.direction = -r.direction;
            r.index = Math.min(Math.max(r.index, r.low), r.high);
          }
          r.nextAt += 1 / rate;
        }
      });

      // 終わり: 速くなりきった高い声部を断ち切り、主和音を強く置く
      if (ending) {
        const h = layout(ctx);
        const at = Math.max(time + TICK, ...runners.map((r) => r.nextAt));
        for (const d of [0, 2, 4, 7]) {
          const index = h.centre + h.degree(d);
          queue.add({ time: at, index, velocity: 0.45, seconds: 5, onPlay: view.add({ time: at, index, voice: 0, seconds: 5, velocity: 0.45 }) });
        }
        queue.add({ time: at, index: h.lowRoot, octave: -1, velocity: 0.5, seconds: 5, onPlay: view.add({ time: at, index: h.lowRoot, voice: 1, seconds: 5, velocity: 0.5 }) });
        endAt = at + 6;
      }
    });

    return {
      pointer: (_x, y, height) => !ending && runAt(ctx, queue, view, y, height),
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

// --- II. ブギウギの層 ---

const BLUES = [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 0]; // 12 小節の和音（主音からの度数。I・IV・V）
const BOOGIE = [0, 2, 4, 5, 6, 5, 4, 2]; // 1 小節の 8 分音符（根音・3 度・5 度・6 度・7 度・6 度・5 度・3 度）
const RIFFS = [
  [7, 6, 4, 2],
  [4, 6, 7, 9, 7, 6],
  [2, 4, 7, 4, 6],
  [9, 7, 6, 4, 6, 7],
];
// 右手の型の速さ（左手の 8 分音符に対する比）と、入る・抜ける時期、オクターブ
const LAYERS = [
  { ratio: 3 / 2, from: 0.1, to: 0.86, octave: 0 },
  { ratio: 5 / 4, from: 0.28, to: 0.76, octave: 1 },
  { ratio: 7 / 4, from: 0.45, to: 0.66, octave: 1 },
];

const boogie: Movement = {
  title: { ja: "II. ブギウギの層", en: "II. Boogie-woogie layers" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const eighth = () => 30 / ctx.bpm();
    let bassAt = startAt + 0.5;
    let step = 0; // 左手が弾いた 8 分音符の数
    let chord = 0; // 今の和音（右手の型もこれに合わせる）
    const riffs = [...RIFFS].sort(() => rand() - 0.5);
    const layers = LAYERS.map((l, i) => ({ ...l, riff: riffs[i], nextAt: startAt + 0.5, position: 0 }));
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = layout(ctx);

      while (bassAt < time + TICK) {
        const at = bassAt;
        const progress = (at - startAt) / boogie.duration;
        const bar = Math.floor(step / 8) % BLUES.length;
        const beat = step % 8;
        // 12 小節の頭で、終わりに来ていれば主和音（7 の音を足したブルースの和音）で終える
        if (beat === 0 && bar === 0 && step > 0 && progress >= 0.9) {
          ending = true;
          const root = h.lowRoot;
          queue.add({ time: at, index: root, octave: -1, velocity: 0.55, seconds: 5, onPlay: view.add({ time: at, index: root, voice: 0, seconds: 5, velocity: 0.55 }) });
          for (const d of [0, 2, 4, 6]) {
            const index = h.centre + h.degree(d);
            queue.add({ time: at, index, velocity: 0.4, seconds: 5, onPlay: view.add({ time: at, index, voice: 1, seconds: 5, velocity: 0.4 }) });
          }
          endAt = at + 6;
          return;
        }
        chord = h.degree(BLUES[bar]);
        const index = h.lowRoot + chord + h.degree(BOOGIE[beat]);
        const velocity = (beat % 2 === 0 ? 0.42 : 0.3) * (0.85 + 0.25 * Math.sin(Math.PI * Math.min(progress, 1)));
        const seconds = eighth() * 1.1;
        queue.add({ time: at, index, octave: -1, velocity, seconds, onPlay: view.add({ time: at, index, voice: 0, seconds, velocity }) });
        // 小節の頭では、根音をもう 1 オクターブ下に重ねる
        if (beat === 0) queue.add({ time: at, index: h.lowRoot + chord, octave: -2, velocity: velocity * 0.7, seconds: eighth() * 4 });
        step++;
        bassAt += eighth();
      }

      // 右手の型: 左手とは違う速さで、今の和音に合わせて型を繰り返す。入るときと抜けるときは音量でなじませる
      layers.forEach((l, i) => {
        while (l.nextAt < time + TICK) {
          const at = l.nextAt;
          l.nextAt += eighth() / l.ratio;
          const progress = (at - startAt) / boogie.duration;
          const edge = 0.05;
          const level = Math.min(1, (progress - l.from) / edge, (l.to - progress) / edge);
          if (level <= 0) {
            l.position = 0;
            continue;
          }
          const index = h.centre + chord + h.degree(l.riff[l.position % l.riff.length]) + l.octave * h.perOctave;
          const accent = l.position % l.riff.length === 0 ? 1.2 : 1;
          const velocity = (0.32 - 0.04 * i) * level * accent;
          const seconds = (eighth() / l.ratio) * 1.2;
          const placed = h.place(index);
          queue.add({ time: at, index: placed.index, octave: placed.octave, velocity, seconds, onPlay: view.add({ time: at, index, voice: i + 1, seconds, velocity }) });
          l.position++;
        }
      });
    });

    return {
      pointer: (_x, y, height) => !ending && runAt(ctx, queue, view, y, height),
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

// --- III. 収束するカノン ---

const SPEEDS = [1, Math.SQRT2, 2, 2 * Math.SQRT2];
const OCTAVES = [-1, 0, 1, 2]; // 速い声部ほど高い
const DURATIONS = [1, 1, 1, 2, 2, 3, 0.5]; // 旋律の 1 音の長さ（拍）

type Note = { at: number; offset: number; beats: number };

const convergence: Movement = {
  title: { ja: "III. 収束するカノン", en: "III. Converging canon" },
  duration: 270,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const h0 = layout(ctx);
    const beat = 60 / ctx.bpm();

    // 旋律を 1 つ作る。一番遅い声部がこの楽章のほとんどをかけて弾く長さにし、主音で終える
    const total = Math.max(16, Math.floor((convergence.duration * 0.9) / beat));
    const top = h0.perOctave + 3;
    const melody: Note[] = [];
    let offset = 0;
    let beats = 0;
    while (beats < total) {
      const length = DURATIONS[Math.floor(rand() * DURATIONS.length)];
      const span = length === 0.5 ? [0.5, 0.5] : [length];
      for (const b of span) {
        melody.push({ at: beats, offset, beats: b });
        beats += b;
        const leap = rand() < 0.15 ? Math.floor(random(2, 5)) : 1;
        offset += (rand() < 0.5 ? -1 : 1) * leap;
        offset = Math.min(Math.max(offset, 0), top);
      }
    }
    // 最後の 1 音で、すべての声部が同じ時刻に主音に着く
    melody.push({ at: beats, offset: h0.perOctave, beats: 8 });
    const meet = startAt + 0.5 + beats * beat;
    // 声部ごとの始まり: 速い声部ほど遅れて始まり、同じ時刻に旋律を弾き終える
    const voices = SPEEDS.map((speed, i) => ({ speed, octave: OCTAVES[i], start: meet - (beats * beat) / speed, position: 0 }));
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = layout(ctx);
      voices.forEach((v, voice) => {
        while (v.position < melody.length) {
          const note = melody[v.position];
          const at = v.start + (note.at * beat) / v.speed;
          if (at >= time + TICK) break;
          v.position++;
          if (at < startAt) continue;
          const last = v.position === melody.length;
          const remaining = (meet - at) / (meet - startAt); // 収束に近づくほど強くなる
          const velocity = last ? 0.5 : (0.2 + 0.25 * (1 - remaining)) * (1 - 0.08 * voice);
          const seconds = last ? 8 : ((note.beats * beat) / v.speed) * 1.1;
          const index = h.lowRoot + note.offset + v.octave * h.perOctave;
          const placed = h.place(index);
          queue.add({ time: at, index: placed.index, octave: placed.octave, velocity, seconds, onPlay: view.add({ time: at, index, voice, seconds, velocity }) });
        }
      });
      if (voices.every((v) => v.position >= melody.length)) {
        ending = true;
        endAt = meet + 9;
      }
    });

    return {
      pointer: (_x, y, height) => !ending && runAt(ctx, queue, view, y, height),
      draw(g, width, height) {
        view.draw(g, width, height);
        // 上端に、声部ごとの旋律の進み具合を線で描く。遅い声部は先にいて、速い声部が追いつき、最後の音でそろう
        const now = Tone.now();
        const span = width - MARGIN_LEFT - MARGIN_RIGHT;
        voices.forEach((v, i) => {
          const done = Math.min(Math.max(((now - v.start) * v.speed) / (beats * beat), 0), 1);
          g.fillStyle = `hsla(${HUES[i]}, 70%, 65%, 0.7)`;
          g.fillRect(MARGIN_LEFT, 10 + i * 6, span * done, 3);
        });
        g.strokeStyle = "rgba(255, 255, 255, 0.3)";
        g.beginPath();
        g.moveTo(MARGIN_LEFT + span, 6);
        g.lineTo(MARGIN_LEFT + span, 36);
        g.stroke();
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

export const nancarrow: Sonata = {
  id: "nancarrow",
  composer: { ja: "コンロン・ナンカロウ", en: "Conlon Nancarrow" },
  initials: "C.N.",
  // ミクソリディアン（長音階の 7 の音を半音下げた音階）。ブギウギの左手と、ブルースの和音になじむ
  scale: { id: "mixolydian", group: "", name: { ja: "ミクソリディアン", en: "Mixolydian" }, steps: [0, 2, 4, 5, 7, 9, 10] },
  movements: [acceleration, boogie, convergence],
  // ナンカロウの自動ピアノは、鳴りを硬く変えた古い楽器だった。調律は初めから「古いピアノ」にしておく
  tuning: "old",
};
