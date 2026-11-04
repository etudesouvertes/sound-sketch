import * as Tone from "tone";
import { pitchAt, pitchIndexAt } from "../scales";
import { MARGIN_RIGHT, type Movement, type MovementContext, musicFrom, pendingQueue, rand, random, scheduler, type Sonata, TICK, yOf } from "./movement";

// ブライアン・イーノがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// I.  長さの違うループ: 1〜2 音の短い句を、長さの違うループに載せて重ねる。同じ響きはほとんど二度と来ない
// II. こだま: ぽつんと置いた音が、テープのこだまのように一定の間で繰り返されながら小さくなり、重なって和音になる
// III. 規則から生まれる旋律: 隣の音へ動きやすい、ときどき休む、といった規則だけで旋律が生まれ、低い音がゆっくり支える
// イーノの楽章は刻みを持たないので、テンポの設定は使わない。時刻はすべて音の時計（AudioContext の時刻）で持つ

// 中ほどより上の音域にある主音（なければ一番低い主音）
const rootAbove = (ctx: MovementContext, from: number) => {
  const pitches = ctx.pitches();
  const above = pitches.findIndex((p, i) => p.isRoot && i >= from);
  return Math.max(above >= 0 ? above : pitches.findIndex((p) => p.isRoot), 0);
};

const PAD = 22; // 音部記号・調号と、いちばん左の音のあいだ（px）
const LOOP_PAD = 34; // ループの輪（半径 28 まで）が、音部記号・調号にかからない余白（px）

// --- I. 長さの違うループ ---

type TapeLoop = {
  index: number;
  second: number | null; // 句の 2 音目（なければ 1 音だけ）
  gap: number; // 2 音目までの間（秒）
  length: number; // ループの長さ（秒）
  nextAt: number;
  dying: boolean; // 次に巡ってきたところで外す
  glow: number;
  hue: number;
};

const MIN_LOOP = 15;
const MAX_LOOP = 35;

const tapeLoops: Movement = {
  title: { ja: "I. 長さの違うループ", en: "I. Loops of different lengths" },
  duration: 300,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    let loops: TapeLoop[] = [];
    let lastAdd = -Infinity;
    let lastRemove = -Infinity;
    let finalLoop: TapeLoop | null = null;

    const add = (index: number, length: number, firstAt: number) => {
      const count = ctx.pitches().length;
      const second = rand() < 0.5 ? Math.min(Math.max(index + (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * 2)), 0), count - 1) : null;
      loops.push({ index, second, gap: random(0.6, 2.2), length, nextAt: firstAt, dying: false, glow: 0, hue: random(180, 260) });
    };

    // 鳴っているループの本数の目標。1 本から少しずつ増え、中ほどを過ぎると減り、最後は 1 本になる
    const most = () => Math.min(8, Math.round(3 + 2 * ctx.density()));
    const target = (progress: number) =>
      progress < 0.55 ? Math.max(1, Math.ceil((most() * progress) / 0.55)) : Math.max(1, Math.ceil((most() * (0.95 - progress)) / 0.4));

    const loop = scheduler(ctx, (time) => {
      if (endAt !== Infinity) return;
      const progress = (time - startAt) / tapeLoops.duration;
      const alive = loops.filter((l) => !l.dying);
      const count = ctx.pitches().length;

      if (progress >= 0.95 && alive.length <= 1 && !finalLoop) {
        // 残った 1 本が次に巡ってきたときの句で終える
        finalLoop = alive[0] ?? null;
        if (!finalLoop) endAt = time + 1;
      } else if (!finalLoop) {
        if (alive.length < target(progress) && time - lastAdd > 10) {
          add(Math.floor(random(count * 0.35, count)), random(MIN_LOOP, MAX_LOOP), time + random(0.3, 3));
          lastAdd = time;
        } else if (alive.length > target(progress) && time - lastRemove > 8) {
          alive[0].dying = true; // 古いループから外す
          lastRemove = time;
        }
      }
      if (progress > 1.2 && endAt === Infinity) endAt = time + 1;

      const pitches = ctx.pitches();
      for (const l of [...loops]) {
        if (l.nextAt >= time + TICK) continue;
        if (l.dying) {
          loops = loops.filter((x) => x !== l);
          continue;
        }
        const at = Math.max(l.nextAt, time);
        const velocity = random(0.22, 0.4);
        ctx.piano.triggerAttackRelease(pitchAt(pitches, l.index).freq, 5, at, velocity);
        if (l.second !== null) ctx.piano.triggerAttackRelease(pitchAt(pitches, l.second).freq, 5, at + l.gap, velocity * 0.85);
        Tone.getDraw().schedule(() => (l.glow = 1), at);
        l.nextAt += l.length;
        if (l === finalLoop) endAt = at + l.gap + 8;
      }
    });

    let last = performance.now();
    return {
      // クリックした場所にループを置く。縦の位置で高さ、横の位置で長さ（15〜35 秒）
      pointer(x, y, height) {
        if (endAt !== Infinity || finalLoop || loops.length >= 12) return;
        const from = musicFrom(LOOP_PAD);
        const span = innerWidth - from - MARGIN_RIGHT;
        const length = MIN_LOOP + Math.min(Math.max((x - from) / span, 0), 1) * (MAX_LOOP - MIN_LOOP);
        add(pitchIndexAt(y, height, ctx.pitches().length), length, Tone.now() + 0.05);
      },
      // ループを、横に長さ・縦に高さの位置へ輪で描く。輪を回る点が、次に鳴るまでの巡り
      draw(g, width, height) {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const count = ctx.pitches().length;
        const from = musicFrom(LOOP_PAD);
        const span = width - from - MARGIN_RIGHT;
        const at = Tone.now();
        for (const l of loops) {
          l.glow = Math.max(0, l.glow - dt / 2);
          const x = from + ((l.length - MIN_LOOP) / (MAX_LOOP - MIN_LOOP)) * span;
          const y = yOf(l.index, height, count);
          const alpha = l.dying ? 0.35 : 1;
          g.strokeStyle = `hsla(${l.hue}, 50%, 70%, ${(0.25 + 0.5 * l.glow) * alpha})`;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y, 18 + 10 * l.glow, 0, Math.PI * 2);
          g.stroke();
          const phase = 1 - (l.nextAt - at) / l.length;
          const angle = phase * Math.PI * 2 - Math.PI / 2;
          g.fillStyle = `hsla(${l.hue}, 70%, 80%, ${0.8 * alpha})`;
          g.beginPath();
          g.arc(x + Math.cos(angle) * 18, y + Math.sin(angle) * 18, 3, 0, Math.PI * 2);
          g.fill();
          if (l.second !== null) {
            g.fillStyle = `hsla(${l.hue}, 60%, 70%, ${(0.3 + 0.6 * l.glow) * alpha})`;
            g.beginPath();
            g.arc(x, yOf(l.second, height, count), 3, 0, Math.PI * 2);
            g.fill();
          }
        }
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
        loops = [];
      },
    };
  },
};

// --- II. こだま ---

type Ring = { time: number; x: number; index: number; velocity: number };

const echoes: Movement = {
  title: { ja: "II. こだま", en: "II. Echoes" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    let rings: Ring[] = [];
    const delay = random(2.6, 3.8); // こだまの間（楽章のあいだ変えない）
    const count = () => ctx.pitches().length;
    let centre = Math.floor(count() * 0.55); // 音を選ぶ中心。ときどき 1 つずれる
    let nextAt = startAt + 1.5;
    let ending = false;

    // 1 音を置くと、こだまの間ごとに 6 割の強さで繰り返し、聞こえなくなるまで続く
    const place = (time: number, index: number, velocity: number) => {
      const x = random(0.1, 0.9);
      let k = 0;
      for (let v = velocity; v > 0.04; v *= 0.6, k++) {
        const ring = { time: time + k * delay, x, index, velocity: v };
        queue.add({ time: ring.time, index, velocity: v, seconds: 3, onPlay: () => rings.push(ring) });
      }
      return time + (k - 1) * delay;
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending || nextAt >= time + TICK) return;
      const progress = (nextAt - startAt) / echoes.duration;
      if (progress >= 0.92) {
        // 最後の 1 音: 主音を置き、こだまが消えるまで待つ
        ending = true;
        const lastEcho = place(nextAt, rootAbove(ctx, Math.floor(count() * 0.4)), 0.45);
        endAt = lastEcho + 4;
        return;
      }
      if (rand() < 0.2) centre = Math.min(Math.max(centre + (rand() < 0.5 ? -1 : 1), 2), count() - 3);
      place(nextAt, Math.min(Math.max(centre + Math.floor(random(-2, 3)), 0), count() - 1), random(0.25, 0.45));
      // 次の音までの間。中ほどで最も短い
      nextAt += Math.min(14, random(4, 9) / (0.5 + Math.sin(Math.PI * progress)) / Math.sqrt(ctx.density()));
    });

    return {
      // クリックした高さの音を置く（こだまも続く）
      pointer(_x, y, height) {
        if (ending) return;
        place(Tone.now() + 0.02, pitchIndexAt(y, height, count()), 0.4);
      },
      // 鳴るたびに、その場所から輪が広がる。こだまは同じ場所から、だんだん弱い輪になる
      draw(g, width, height) {
        const now = Tone.now();
        rings = rings.filter((r) => now - r.time < 5);
        const from = musicFrom(PAD);
        const span = width - from - MARGIN_RIGHT;
        for (const r of rings) {
          const age = now - r.time;
          const x = from + r.x * span;
          const y = yOf(r.index, height, count());
          g.strokeStyle = `hsla(150, 50%, 75%, ${r.velocity * 1.6 * (1 - age / 5)})`;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y, 4 + age * 30, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = `hsla(150, 60%, 80%, ${r.velocity * 2 * Math.max(0, 1 - age)})`;
          g.beginPath();
          g.arc(x, y, 3 + 6 * r.velocity, 0, Math.PI * 2);
          g.fill();
        }
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
        queue.clear();
        rings = [];
      },
    };
  },
};

// --- III. 規則から生まれる旋律 ---

type Trace = { time: number; index: number; voice: "melody" | "canon" | "bass"; seconds: number };

const UNIT = 0.45; // 旋律の長さの単位（秒）
const WINDOW = 30; // 画面に残す時間（秒）

const rules: Movement = {
  title: { ja: "III. 規則から生まれる旋律", en: "III. Melody from rules" },
  duration: 270,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    let traces: Trace[] = [];
    const count = () => ctx.pitches().length;
    const low = () => Math.floor(count() * 0.4);

    let note = rootAbove(ctx, Math.floor(count() * 0.55));
    let melodyAt = startAt + 0.5;
    let bassAt = startAt + 0.5;
    let shift = 0; // 低い音の中心のずれ（主音から 0・2・3 音上）
    let shiftAt = startAt + random(30, 40);
    let ending = false;

    const trace = (t: Trace) => () => traces.push(t);

    // 次の音の規則: 隣の音へが半分、2 つ隣が 4 分の 1、同じ音が 1 割、残りは 3 つ隣。音域の外へは出ない
    const nextNote = (from: number) => {
      const roll = rand();
      const size = roll < 0.5 ? 1 : roll < 0.75 ? 2 : roll < 0.85 ? 0 : 3;
      const up = rand() < 0.5 ? 1 : -1;
      const next = from + size * up;
      return next < low() || next >= count() ? from - size * up : next;
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;

      if (bassAt < time + TICK) {
        // 低い音: 4〜7 秒ごとに、主音か、その少し上を長く
        const progress = (bassAt - startAt) / rules.duration;
        if (bassAt >= shiftAt && progress < 0.85) {
          shift = [0, 2, 3][Math.floor(rand() * 3)];
          shiftAt = bassAt + random(30, 40);
        }
        if (progress >= 0.85) shift = 0;
        const index = rootAbove(ctx, 0) + shift;
        const seconds = random(5, 8);
        queue.add({ time: bassAt, index, velocity: 0.15 + 0.15 * Math.sin(Math.PI * Math.min(progress, 1)), seconds, onPlay: trace({ time: bassAt, index, voice: "bass", seconds }) });
        bassAt += random(4, 7);
      }

      if (melodyAt >= time + TICK) return;
      const at = melodyAt;
      const progress = (at - startAt) / rules.duration;
      const length = UNIT * [1, 1, 1, 2, 2, 3][Math.floor(rand() * 6)];
      melodyAt += length;

      if (progress >= 0.93) {
        // 終わり: 近い主音へ 1 音ずつ降り、着いたら主音を重ねて終える
        const home = rootAbove(ctx, low());
        if (note !== home) note += note > home ? -1 : 1;
        queue.add({ time: at, index: note, velocity: 0.3, seconds: 4, onPlay: trace({ time: at, index: note, voice: "melody", seconds: 4 }) });
        if (note === home) {
          ending = true;
          queue.add({ time: at + 0.02, index: rootAbove(ctx, 0), octave: -1, velocity: 0.3, seconds: 8 });
          queue.add({ time: at + 0.04, index: home, octave: 1, velocity: 0.18, seconds: 8 });
          endAt = at + 9;
        }
        return;
      }
      if (progress > 1.15) {
        ending = true;
        endAt = at + 6;
        return;
      }

      // 休むかどうか。中ほどで休みが少ない
      const rest = Math.max(0.08, 0.4 - 0.25 * Math.sin(Math.PI * progress) * Math.sqrt(ctx.density()));
      if (rand() < rest) return;
      note = nextNote(note);
      const velocity = 0.2 + 0.2 * Math.sin(Math.PI * progress) + random(0, 0.08);
      const seconds = length * 2.5;
      queue.add({ time: at, index: note, velocity, seconds, onPlay: trace({ time: at, index: note, voice: "melody", seconds }) });
      // 中ほどだけ、同じ旋律が少し遅れて 1 オクターブ上でなぞる
      if (progress >= 0.35 && progress < 0.78) {
        const index = note;
        queue.add({ time: at + 2.7, index, octave: 1, velocity: velocity * 0.5, seconds, onPlay: trace({ time: at + 2.7, index, voice: "canon", seconds }) });
      }
    });

    return {
      // クリックした高さへ旋律が跳び、そこから続く
      pointer(_x, y, height) {
        if (ending) return;
        note = Math.min(Math.max(pitchIndexAt(y, height, count()), low()), count() - 1);
        const time = Tone.now() + 0.02;
        queue.add({ time, index: note, velocity: 0.4, seconds: 2, onPlay: trace({ time, index: note, voice: "melody", seconds: 2 }) });
      },
      // 右端が今。鳴った音が左へ流れていく（旋律は線でつなぎ、低い音は長い帯）
      draw(g, width, height) {
        const now = Tone.now();
        traces = traces.filter((tr) => now - tr.time - tr.seconds < WINDOW);
        // 音は、音部記号と調号の右で消える
        const left = musicFrom();
        const span = width - left - MARGIN_RIGHT;
        const xOf = (time: number) => width - MARGIN_RIGHT - ((now - time) / WINDOW) * span;
        const fade = (time: number) => Math.max(0, 1 - (now - time) / WINDOW);

        for (const tr of traces.filter((tr) => tr.voice === "bass")) {
          const y = yOf(tr.index, height, count());
          g.fillStyle = `hsla(30, 40%, 60%, ${0.25 * fade(tr.time)})`;
          g.fillRect(Math.max(xOf(tr.time), left), y - 3, Math.min(xOf(tr.time + tr.seconds), width - MARGIN_RIGHT) - Math.max(xOf(tr.time), left), 6);
        }
        const melody = traces.filter((tr) => tr.voice === "melody");
        g.strokeStyle = "hsla(50, 60%, 70%, 0.3)";
        g.lineWidth = 1.5;
        g.beginPath();
        melody.forEach((tr, i) => {
          const x = Math.max(xOf(tr.time), left);
          const y = yOf(tr.index, height, count());
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
        for (const tr of traces.filter((tr) => tr.voice !== "bass")) {
          const x = xOf(tr.time);
          if (x < left) continue;
          const recent = Math.max(0, 1 - (now - tr.time) / 1.5);
          const hue = tr.voice === "melody" ? 50 : 280;
          g.fillStyle = `hsla(${hue}, 70%, ${60 + 20 * recent}%, ${(0.3 + 0.7 * recent) * fade(tr.time)})`;
          g.beginPath();
          g.arc(x, yOf(tr.index, height, count()), tr.voice === "melody" ? 3 + 5 * recent : 2 + 3 * recent, 0, Math.PI * 2);
          g.fill();
        }
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
        queue.clear();
        traces = [];
      },
    };
  },
};

export const eno: Sonata = {
  id: "eno",
  composer: { ja: "ブライアン・イーノ", en: "Brian Eno" },
  initials: "B.E.",
  // ループやこだまがどう重なっても濁らないよう、半音を含まない 5 音
  scale: { id: "major-pentatonic", group: "", name: { ja: "メジャーペンタトニック", en: "Major pentatonic" }, steps: [0, 2, 4, 7, 9] },
  root: "D", // 主音。大譜表が画面に収まる D
  movements: [tapeLoops, echoes, rules],
};
