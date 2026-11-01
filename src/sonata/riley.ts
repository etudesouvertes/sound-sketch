import * as Tone from "tone";
import { pitchIndexAt } from "../scales";
import { layout, MARGIN_LEFT, MARGIN_RIGHT, type Movement, type MovementContext, pendingQueue, rand, random, scheduler, type Sonata, TICK, yOf } from "./movement";

// テリー・ライリーがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// I.   歩みの違う奏者: 短い型（モジュール）を並べた譜面を、4 人の奏者がそれぞれの歩みで進む。どの型を何回繰り返すかは奏者まかせで、
//      先頭と最後尾は 3 つ以上離れない。高い主音の 8 分音符（パルス）がずっと刻み、全員が最後の型を弾き終えると終わる
// II.  純正の響き: 平均律でなく純正律（主音からの整数比）に調律し直したピアノで、ゆっくりした分散和音を、1 音ずつ伸ばしては縮める
// III. 持続音と旋法: 低い持続音の上で、右手の速い型が音を足したり移したりしながら繰り返され、熱を帯びて駆け上がって終わる
// 時刻はすべて音の時計で持つ

// --- 画面: 鳴った音が右端から左へ流れる。声部ごとに色を変える ---

const HUES = [45, 0, 160, 210, 280];
type Mark = { time: number; index: number; voice: number; seconds: number; velocity: number };
const WINDOW = 14;

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
        g.fillStyle = `hsla(${HUES[m.voice % HUES.length]}, 70%, ${55 + 25 * ringing}%, ${(0.25 + 0.6 * ringing) * fade})`;
        g.beginPath();
        g.arc(x, y, 2 + 5 * m.velocity + 3 * ringing, 0, Math.PI * 2);
        g.fill();
      }
    },
  };
}

// クリック: その高さの音を、8 分音符で 4 回、だんだん弱く繰り返す
function repeatAt(ctx: MovementContext, queue: ReturnType<typeof pendingQueue>, view: ReturnType<typeof markView>, y: number, height: number) {
  const count = ctx.pitches().length;
  const index = Math.min(Math.max(pitchIndexAt(y, height, count), 0), count - 1);
  const now = Tone.now() + 0.02;
  for (let i = 0; i < 4; i++) {
    const time = now + (i * 30) / ctx.bpm();
    const velocity = 0.4 * 0.75 ** i;
    queue.add({ time, index, velocity, seconds: 0.6, onPlay: view.add({ time, index, voice: 4, seconds: 0.6, velocity }) });
  }
}

// --- I. 歩みの違う奏者 ---

// 型の 1 つの区切り（8 分音符 1 つ分）。note は、その区切りで鳴らし始める音の度数（null は休みか、前の音を伸ばしている）
type Slot = { note: number | null; length: number };
type Module = Slot[];

const MODULES = 24;
const AREAS = [0, 3, 5, 1, 4, 0]; // 4 つの型ごとに、中心にする和音の根音の度数（終わりは主和音に帰る）
const PLAYERS = 4;
const MAX_SPREAD = 3; // 先頭の奏者と最後尾の奏者の、型の番号の差の上限

function newModule(area: number): Module {
  // 長い 1 音だけの型もときどき混ぜる
  if (rand() < 0.12) return [{ note: area + [0, 2, 4][Math.floor(rand() * 3)], length: 8 }, ...Array.from({ length: 7 }, () => ({ note: null, length: 0 }))];
  const length = [2, 3, 4, 4, 5, 6, 8][Math.floor(rand() * 7)];
  const slots: Module = [];
  let previous = area;
  while (slots.length < length) {
    if (slots.length > 0 && rand() < 0.2) {
      slots.push({ note: null, length: 0 }); // 休み
      continue;
    }
    // 和音の音（根音・3 度・5 度・オクターブ）を中心に、ときどき隣の音を通る
    const chord = [0, 2, 4, 7].map((d) => area + d);
    const note = rand() < 0.25 ? previous + (rand() < 0.5 ? -1 : 1) : chord[Math.floor(rand() * chord.length)];
    const hold = Math.min(rand() < 0.3 ? 2 : 1, length - slots.length);
    slots.push({ note, length: hold });
    for (let i = 1; i < hold; i++) slots.push({ note: null, length: 0 });
    previous = note;
  }
  return slots;
}

type Player = { module: number; slot: number; repeatsLeft: number; octave: number; startAt: number; resting: boolean; done: boolean };

const players: Movement = {
  title: { ja: "I. 歩みの違う奏者", en: "I. Players at their own pace" },
  duration: 300,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const eighth = () => 30 / ctx.bpm();
    const score = Array.from({ length: MODULES }, (_, i) => newModule(AREAS[Math.floor(i / (MODULES / AREAS.length))]));
    const meanLength = score.reduce((sum, m) => sum + m.length, 0) / MODULES;
    // 4 人が楽章のおよそ 85% で譜面を弾き終える回数を、平均の繰り返し回数にする
    const meanRepeats = () => Math.max(1, (0.85 * players.duration) / eighth() / MODULES / meanLength);
    const repeatsFor = () => Math.max(1, Math.round(meanRepeats() * random(0.5, 1.5)));
    // 奏者は 2 小節ずつ遅れて入る。音域は 1 人ずつ違う
    const band: Player[] = [0, 1, -1, 0].map((octave, i) => ({
      module: 0,
      slot: 0,
      repeatsLeft: repeatsFor(),
      octave,
      startAt: startAt + 0.5 + (i + 1) * 16 * eighth(),
      resting: false,
      done: false,
    }));
    let pulseAt = startAt + 0.5;
    let pulseStep = 0;
    let finishAt = Infinity; // 全員が弾き終えたあと、パルスだけが続く時刻の終わり

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (endAt !== Infinity) return;
      while (pulseAt < time + TICK) {
        const at = pulseAt;
        const h = layout(ctx);
        const progress = (at - startAt) / players.duration;
        if (at >= finishAt) {
          endAt = at + 4;
          return;
        }
        // パルス: 高い主音の 8 分音符
        const pulseVelocity = (pulseStep % 2 === 0 ? 0.2 : 0.15) * (0.8 + 0.3 * Math.sin(Math.PI * Math.min(progress, 1)));
        queue.add({ time: at, index: h.topRoot, velocity: pulseVelocity, seconds: eighth() * 0.9, onPlay: view.add({ time: at, index: h.topRoot, voice: 4, seconds: eighth(), velocity: pulseVelocity }) });

        const slowest = Math.min(...band.filter((p) => !p.done).map((p) => p.module), MODULES - 1);
        band.forEach((p, voice) => {
          if (p.done || at < p.startAt - 1e-6) return;
          const module = score[p.module];
          const slot = module[p.slot];
          if (!p.resting && slot.note !== null) {
            const index = h.centre + h.degree(slot.note) + p.octave * h.perOctave;
            const placed = h.place(index);
            const velocity = (0.3 + 0.1 * Math.sin(Math.PI * Math.min(progress, 1))) * random(0.85, 1.1) * (p.octave > 0 ? 0.8 : 1);
            const seconds = eighth() * slot.length * 1.2;
            queue.add({ time: at, ...placed, velocity, seconds, onPlay: view.add({ time: at, index, voice, seconds, velocity }) });
          }
          p.slot++;
          if (p.slot < module.length) return;
          // 型を 1 回弾き終えた: 次の型へ進むか、もう一度繰り返すか（ときどき 1 回休む）
          p.slot = 0;
          p.repeatsLeft--;
          p.resting = rand() < 0.08;
          const ahead = p.module - slowest >= MAX_SPREAD;
          const behind = Math.max(...band.map((q) => q.module)) - p.module >= MAX_SPREAD;
          const late = progress > 1.1; // 長引いたら、急いで進む
          if ((p.repeatsLeft <= 0 && !ahead) || behind || late) {
            if (p.module === MODULES - 1) {
              p.done = true; // 最後の型を弾き終えた奏者から抜ける
              return;
            }
            p.module++;
            p.repeatsLeft = repeatsFor();
          }
        });
        // 全員が抜けたら、パルスだけを 2 小節刻んで終える
        if (finishAt === Infinity && band.every((p) => p.done)) finishAt = at + 16 * eighth();
        pulseStep++;
        pulseAt += eighth();
      }
    });

    return {
      pointer: (_x, y, height) => endAt === Infinity && repeatAt(ctx, queue, view, y, height),
      draw(g, width, height) {
        view.draw(g, width, height);
        // 上端に譜面の型を並べ、奏者がそれぞれどの型にいるかを点で示す
        const span = width - MARGIN_LEFT - MARGIN_RIGHT;
        const cell = span / MODULES;
        g.fillStyle = "rgba(255, 255, 255, 0.12)";
        for (let i = 0; i < MODULES; i++) g.fillRect(MARGIN_LEFT + i * cell + 1, 10, cell - 2, 4);
        band.forEach((p, i) => {
          if (p.done) return;
          g.fillStyle = `hsla(${HUES[i]}, 70%, 65%, 0.9)`;
          g.beginPath();
          g.arc(MARGIN_LEFT + (p.module + 0.5) * cell, 22 + i * 6, 2.5, 0, Math.PI * 2);
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

// --- II. 純正の響き ---

// 主音からの半音の数ごとに、純正律の比と、平均律からのずれ（セント）
const JUST: { ratio: string; cents: number }[] = [
  { ratio: "1/1", cents: 0 },
  { ratio: "16/15", cents: 11.7 },
  { ratio: "9/8", cents: 3.9 },
  { ratio: "6/5", cents: 15.6 },
  { ratio: "5/4", cents: -13.7 },
  { ratio: "4/3", cents: -2 },
  { ratio: "45/32", cents: -9.8 },
  { ratio: "3/2", cents: 2 },
  { ratio: "8/5", cents: 13.7 },
  { ratio: "5/3", cents: -15.6 },
  { ratio: "16/9", cents: -3.9 },
  { ratio: "15/8", cents: -11.7 },
];

// 音高の位置ごとの、純正律でのずれ。主音からの半音の数で決める（平均律から 4 分の 1 音以上外れた音階では、近い半音で見る）
function justOf(ctx: MovementContext, index: number, octave = 0) {
  const h = layout(ctx);
  const root = h.pitches[h.lowRoot]?.freq ?? 261.63;
  const pitch = h.pitches[Math.min(Math.max(index, 0), h.count - 1)].freq * 2 ** octave;
  const semitones = ((Math.round(12 * Math.log2(pitch / root)) % 12) + 12) % 12;
  return JUST[semitones];
}

const PROGRESSION = [0, 3, 0, 4, 5, 3, 1, 4]; // 分散和音の根音の度数を、この順に巡る

const just: Movement = {
  title: { ja: "II. 純正の響き", en: "II. Just intonation" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const step = () => 45 / ctx.bpm(); // 分散和音の 1 音（付点 8 分音符）
    let nextAt = startAt + 0.5;
    let droneAt = startAt + 0.5;
    let chord = 0; // PROGRESSION の何番目か
    let length = 3; // 分散和音の音の数（1 回ごとに伸び、また縮む）
    let growing = true;
    let repeatsLeft = 2;
    let ending = false;
    const ratios: { index: number; ratio: string; time: number }[] = [];

    const play = (index: number, octave: number, time: number, velocity: number, seconds: number, voice: number) => {
      const h = layout(ctx);
      const placed = h.place(index + octave * h.perOctave);
      const j = justOf(ctx, placed.index, placed.octave);
      queue.add({ time, ...placed, cents: j.cents, velocity, seconds, onPlay: view.add({ time, index: index + octave * h.perOctave, voice, seconds, velocity }) });
      if (voice === 1) ratios.push({ index: index + octave * h.perOctave, ratio: j.ratio, time });
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = layout(ctx);

      // 低い持続音: 主音と 5 度を、ゆっくり打ち直す
      if (droneAt < time + TICK) {
        const progress = (droneAt - startAt) / just.duration;
        const velocity = 0.2 + 0.1 * Math.sin(Math.PI * Math.min(progress, 1));
        play(h.lowRoot, -1, droneAt, velocity, step() * 14, 0);
        play(h.lowRoot + h.degree(4), -1, droneAt + 0.05, velocity * 0.8, step() * 14, 0);
        droneAt += step() * 12;
      }

      if (nextAt >= time + TICK) return;
      const progress = (nextAt - startAt) / just.duration;
      if (progress >= 0.94) {
        // 終わり: 純正の主和音を、下から静かに重ねる
        ending = true;
        [0, 4, 7, 9, 11].forEach((d, i) => play(h.lowRoot + h.degree(d), 0, nextAt + i * step() * 0.7, 0.24, 10, 1));
        play(h.lowRoot, -1, nextAt, 0.25, 10, 0);
        endAt = nextAt + 11;
        return;
      }
      // 分散和音: 和音の根音から 3 度ずつ積み上げ、上り下りする（音の数が増えると高い音まで届く）
      const root = h.lowRoot + h.degree(PROGRESSION[chord % PROGRESSION.length]);
      const tones = Array.from({ length }, (_, i) => root + h.degree(2 * i));
      const figure = [...tones, ...tones.slice(1, -1).reverse()];
      const dynamics = 0.2 + 0.15 * Math.sin(Math.PI * Math.min(progress, 1));
      figure.forEach((index, i) => play(index, 0, nextAt + i * step(), dynamics * (i === 0 ? 1.15 : 1) * random(0.9, 1.1), step() * 6, 1));
      nextAt += (figure.length + 1) * step();

      repeatsLeft--;
      if (repeatsLeft > 0) return;
      // 和音を 2 回ずつ鳴らしたら次の和音へ。分散和音は 1 音ずつ伸び、7 音まで行ったら縮む
      chord++;
      repeatsLeft = 2;
      if (growing && length >= 7) growing = false;
      else if (!growing && length <= 3) growing = true;
      length += growing ? 1 : -1;
    });

    return {
      pointer: (_x, y, height) => !ending && repeatAt(ctx, queue, view, y, height),
      draw(g, width, height) {
        view.draw(g, width, height);
        // 鳴っている音の純正律の比を、右端の音の高さのところに小さく出す
        const now = Tone.now();
        const count = ctx.pitches().length;
        g.font = "11px system-ui, sans-serif";
        g.textAlign = "right";
        for (let i = ratios.length - 1; i >= 0; i--) {
          const r = ratios[i];
          const age = now - r.time;
          if (age > 3) {
            ratios.splice(0, i + 1);
            break;
          }
          if (age < 0) continue;
          g.fillStyle = `rgba(255, 255, 255, ${0.5 * (1 - age / 3)})`;
          g.fillText(r.ratio, width - MARGIN_RIGHT - 8, yOf(Math.min(Math.max(r.index, 0), count - 1), height, count) - 6);
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

// --- III. 持続音と旋法 ---

const rainbow: Movement = {
  title: { ja: "III. 持続音と旋法", en: "III. Drone and mode" },
  duration: 270,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const sixteenth = () => 15 / ctx.bpm();
    // 右手の型（度数の並び）。主音の上の 1 オクターブほどから選ぶ
    const newRight = () => Array.from({ length: 5 + Math.floor(rand() * 3) }, () => Math.floor(rand() * 9));
    let right = newRight();
    let rightStep = 0;
    let rightRepeats = 0;
    // 左手の型は 8 分音符で、右手と長さが違う
    let left = [0, 4, 7, 4].slice(0, 3 + Math.floor(rand() * 2));
    let leftStep = 0;
    let stepAt = startAt + 0.5;
    let count16 = 0;
    let runFrom = -1; // 終わりの駆け上がりを始めた 16 分音符の番号
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      while (stepAt < time + TICK) {
        const at = stepAt;
        const h = layout(ctx);
        const progress = (at - startAt) / rainbow.duration;
        const energy = Math.sin((Math.PI / 2) * Math.min(progress / 0.9, 1)); // 終わりに向けて熱を帯びる

        // 低い持続音: 主音と 5 度を 4 小節ごとに打ち直す
        if (count16 % 64 === 0) {
          for (const d of [0, 4]) {
            const index = h.lowRoot + h.degree(d);
            queue.add({ time: at, index, octave: -1, velocity: 0.3, seconds: sixteenth() * 70, onPlay: view.add({ time: at, index, voice: 0, seconds: sixteenth() * 70, velocity: 0.3 }) });
          }
        }

        // 終わり: 主音から 2 オクターブを一気に駆け上がり、高い主音と持続音で終える
        if (progress >= 0.92 && runFrom < 0 && rightStep % right.length === 0) runFrom = count16;
        if (runFrom >= 0) {
          const k = count16 - runFrom;
          const top = 2 * 7;
          if (k > top) {
            ending = true;
            const index = h.centre + h.degree(top);
            const placed = h.place(index);
            queue.add({ time: at, ...placed, velocity: 0.5, seconds: 6, onPlay: view.add({ time: at, index, voice: 1, seconds: 6, velocity: 0.5 }) });
            for (const d of [0, 4, 7]) queue.add({ time: at, index: h.lowRoot + h.degree(d), octave: -1, velocity: 0.4, seconds: 6 });
            endAt = at + 7;
            return;
          }
          const index = h.centre + h.degree(k);
          const placed = h.place(index);
          const velocity = 0.3 + 0.15 * (k / top);
          queue.add({ time: at, ...placed, velocity, seconds: sixteenth() * 2, onPlay: view.add({ time: at, index, voice: 1, seconds: sixteenth() * 2, velocity }) });
          count16++;
          stepAt += sixteenth();
          continue;
        }

        // 右手: 16 分音符の型。強さと、オクターブ上に重ねる割合は、熱が上がるにつれて増える
        const position = rightStep % right.length;
        const index = h.centre + h.degree(right[position]);
        const velocity = (0.18 + 0.2 * energy) * (position === 0 ? 1.25 : 1) * random(0.9, 1.1);
        const placed = h.place(index);
        queue.add({ time: at, ...placed, velocity, seconds: sixteenth() * 1.6, onPlay: view.add({ time: at, index, voice: 1, seconds: sixteenth() * 2, velocity }) });
        if (energy > 0.6 && position % 2 === 0 && rand() < energy - 0.4) {
          const upper = h.place(index + h.perOctave);
          queue.add({ time: at, ...upper, velocity: velocity * 0.7, seconds: sixteenth() * 1.6 });
        }
        rightStep++;
        if (rightStep % right.length === 0 && ++rightRepeats >= 3) {
          // 型を何回か繰り返したら、音を足す・抜く・1 音移す・型ごと移す、のどれかで変える
          rightRepeats = 0;
          const roll = rand();
          if (roll < 0.35 && right.length < 12) right.splice(Math.floor(rand() * (right.length + 1)), 0, Math.floor(rand() * 9));
          else if (roll < 0.5 && right.length > 4) right.splice(Math.floor(rand() * right.length), 1);
          else if (roll < 0.85) {
            const i = Math.floor(rand() * right.length);
            right[i] = Math.max(0, right[i] + (rand() < 0.5 ? -1 : 1));
          } else {
            const shift = rand() < 0.5 ? -1 : 1;
            right = right.map((d) => Math.max(0, d + shift));
          }
          // 熱が上がるほど、高いほうへ広がる
          if (rand() < energy * 0.3) right = right.map((d) => d + 1);
          if (Math.max(...right) > 11) right = right.map((d) => d - 3);
        }

        // 左手: 8 分音符の型（右手と長さが違うので、重なり方が回るたびに変わる）
        if (count16 % 2 === 0 && progress > 0.08) {
          const d = left[leftStep % left.length];
          const index = h.lowRoot + h.degree(d);
          const lv = (0.2 + 0.12 * energy) * random(0.9, 1.1);
          queue.add({ time: at, index, velocity: lv, seconds: sixteenth() * 3, onPlay: view.add({ time: at, index, voice: 2, seconds: sixteenth() * 3, velocity: lv }) });
          leftStep++;
          if (leftStep % (left.length * 8) === 0 && rand() < 0.5) left = [0, [2, 4, 5][Math.floor(rand() * 3)], 7, [4, 9][Math.floor(rand() * 2)]].slice(0, 3 + Math.floor(rand() * 2));
        }
        count16++;
        stepAt += sixteenth();
      }
    });

    return {
      pointer: (_x, y, height) => !ending && repeatAt(ctx, queue, view, y, height),
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

export const riley: Sonata = {
  id: "riley",
  composer: { ja: "テリー・ライリー", en: "Terry Riley" },
  initials: "T.R.",
  // 長音階。主和音のまわりを巡る型と、純正律の明るい長三和音になじむ
  scale: { id: "major", group: "", name: { ja: "長音階（イオニアン）", en: "Major (Ionian)" }, steps: [0, 2, 4, 5, 7, 9, 11] },
  movements: [players, just, rainbow],
};
