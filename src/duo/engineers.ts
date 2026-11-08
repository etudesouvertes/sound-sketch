import * as Tone from "tone";
import { t, type L } from "../i18n";
import { pitchIndexAt, type Scale } from "../scales";
import {
  AEOLIAN,
  clamp,
  DORIAN,
  type Layout,
  layout,
  type Movement,
  type MovementContext,
  pendingQueue,
  pick,
  type Queue,
  rand,
  random,
  scheduler,
  type Sonata,
  TICK,
  timed,
} from "../sonata/movement";
import { FIRST, guideLeft, INFO_Y, legend, markView, noteName, ownerColor, play, SECOND, type View } from "./common";

// 上端の案内の下端（音部記号・調号と重なるかを見るため）
const GUIDE_BOTTOM = INFO_Y + 50;

// 二人の録音技師が、2 台のピアノで連弾したら、という試み。ダブ・テクノの作り方をピアノに移している。
// 1 人がトラック（4 つ打ちの低いキック、裏拍のハイハット、短い和音の刻み）を弾き、もう 1 人が卓に回って、
// 和音をこだま（ディレイ）に送る。こだまは 2 台のあいだを左右に跳ね返り（ピンポン）、返るたびに弱く、高い音から消えて暗くなり、
// テープのように少しずつ音程が揺れる。ときどき 1 つの和音を長いこだまに投げ込み、バネの残響を鳴らし、キックを抜く。
// 和音は長いあいだ 1 つのまま、フィルターを開くように、根音と 5 度だけの暗い響きから、3 度・7 度・9 度・11 度が足されて開いていく。
// I.   刻み: 4 つ打ちの上の和音の刻み。和音が 2 つの間を揺れ、キックを抜いた所でこだまを投げ込む。途中でトラックと卓を交代する
// II.  霧: キックのない遅い楽章。低い主音の持続の上に、長い和音をまばらに置き、長いこだまが重なって霞む。2 人が 2 小節ごとに置く
// III. 開いていく: 根音と 5 度だけの暗い刻みから始めて、楽章全体で少しずつ響きが開き、キック、ハイハットが加わる。開き切って閉じる
//
// 音階は C のエオリアン（設定で選べる）。和音の根音は、5 度が完全 5 度になる音だけにする

const PHRYGIAN: Scale = { id: "phrygian", group: "", name: { ja: "フリジア", en: "Phrygian" }, steps: [0, 1, 3, 5, 7, 8, 10] };
const MIXOLYDIAN: Scale = { id: "mixolydian", group: "", name: { ja: "ミクソリディアン", en: "Mixolydian" }, steps: [0, 2, 4, 5, 7, 9, 10] };

// --- 和音 ---

const mode = () => twoEngineers.scale;
const semi = (d: number) => mode().steps[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
const perfectFifth = (root: number) => semi(root + 4) - semi(root) === 7;
const fit = (d: number) => [d, d + 1, d - 1].map((x) => ((x % 7) + 7) % 7).find((x) => x === 0 || perfectFifth(x)) ?? 0;

// 開く順に足す音（根音からの度数）: 10 度（3 度）、7 度、9 度、11 度。根音と 5 度はいつも鳴らす
const OPENING = [9, 6, 8, 10];
const extensions = (open: number) => Math.round(clamp(open, 0, 1) * OPENING.length);
// 和音の音（画面の中ほどの主音の 1 オクターブ下に根音を置いた、開いた並び。低い順）
function voicing(h: Layout, root: number, open: number): number[] {
  const degrees = [0, 4, ...OPENING.slice(0, extensions(open))].filter((d) => !(d === 8 && semi(root + 8) - semi(root) === 13)); // 短 9 度は濁るので外す
  return degrees.map((d) => h.centre + h.degree(root + d - 7)).sort((a, b) => a - b);
}
function chordName(h: Layout, root: number, open: number): string {
  const letter = noteName(h, h.centre + h.degree(root));
  const n = extensions(open);
  const minor = semi(root + 2) - semi(root) === 3;
  const major7 = semi(root + 6) - semi(root) === 11;
  if (n === 0) return `${letter}5`;
  if (n === 1) return `${letter}${minor ? "m" : ""}`;
  return `${letter}${minor ? "m" : major7 ? "maj" : ""}${["7", "9", "11"][n - 2]}`;
}

// --- こだま: 2 台のあいだを跳ね返る。返るたびに feedback 倍に弱くなり、2 回に 1 回、一番高い音が消える。音程はテープのように揺れる ---

function echo(h: Layout, queue: Queue, view: View, from: number, notes: number[], time: number, velocity: number, seconds: number, delay: number, feedback: number, wow: number) {
  let piano = from;
  let v = velocity;
  let voices = notes;
  let cents = 0;
  for (let k = 1; k <= 24; k++) {
    v *= feedback;
    if (v < 0.015) break;
    time += delay;
    piano = 1 - piano;
    cents += random(-wow, wow);
    if (k % 2 === 0 && voices.length > 1) voices = voices.slice(0, -1);
    for (const n of voices) play(h, queue, view, piano, n, time + random(-0.003, 0.003), v, seconds * 0.9, cents);
  }
}

// --- 区切り ---

type Section = {
  bars: number;
  chords: number[]; // 小節ごとに順に回す根音（度数）
  track: number | "turns"; // トラックを弾く台（turns は 2 小節ごとに交代）。もう一方が卓
  kick: boolean;
  hats: boolean;
  drone?: boolean; // 低い主音を長く伸ばす（霧）
  send: number; // 和音をこだまに送る割合
  feedback: number; // こだまの戻り
  open: [number, number]; // 響きの開き（区切りの初め → 終わり）
};

type DubSpec = {
  title: L;
  duration: number;
  nominal: number;
  pulse: number; // テンポの設定に掛ける倍率（16 分音符 1 つの長さを決める）
  delay: number; // こだまの間隔（16 分音符の数。3 は付点 8 分）
  stab: number; // 和音の長さの倍率
  wow: number; // こだまが返るたびの音程の揺れ（セント）
  patterns: number[][]; // 和音の刻みの型（1 小節の 16 分音符の位置）
  level: (progress: number) => number;
  plan: () => Section[];
};

const STEPS = 16;
const ROLE: [L, L] = [
  { ja: "トラック", en: "track" },
  { ja: "卓（こだまに送る）", en: "desk (echo sends)" },
];

function dubMovement(spec: DubSpec): Movement {
  const movement: Movement = {
    title: spec.title,
    duration: spec.duration,
    start(ctx) {
      let endAt = Infinity;
      const queue = pendingQueue(ctx);
      const view = markView(ctx);
      const scale = movement.duration / spec.nominal;
      const sections = spec.plan().map((s) => ({ ...s, bars: Math.max(1, Math.round(s.bars * scale)), pattern: pick(spec.patterns) }));
      const totalBars = sections.reduce((a, s) => a + s.bars, 0);

      let section = 0;
      let barIn = 0;
      let done = 0;
      let pos = 0;
      let stepAt = Tone.now() + 0.4;
      let ending = false;
      let lastChord: number[] = [];
      const clicks: number[] = [];
      const shown = timed({ section: 0, pos: 0, track: FIRST as number, root: 0, open: 0 });

      const loop = scheduler(ctx, (time) => {
        queue.flush(time);
        while (!ending && stepAt < time + TICK) {
          const h = layout(ctx);
          const s = 60 / (ctx.bpm() * spec.pulse * 4);
          const sec = sections[section];
          const progress = (done + pos / STEPS) / totalBars;
          const within = (barIn + pos / STEPS) / sec.bars;
          const open = sec.open[0] + (sec.open[1] - sec.open[0]) * within;
          const root = fit(sec.chords[barIn % sec.chords.length]);
          const track = sec.track === "turns" ? (Math.floor(done / 2) % 2 === 0 ? FIRST : SECOND) : sec.track;
          const desk = 1 - track;
          const level = spec.level(progress);
          const at = stepAt + random(-0.004, 0.004);
          shown.set(stepAt, { section, pos, track, root, open });

          // 4 つ打ちのキック（主音はいつも同じ）と、裏拍のハイハット
          if (sec.kick && pos % 4 === 0) play(h, queue, view, track, h.lowRoot, at, level * 1.0, 0.14);
          if (sec.hats && pos % 4 === 2) play(h, queue, view, track, h.centre + h.degree(11), at, level * 0.4, 0.04);
          // 霧: 2 小節ごとに、低い根音を長く伸ばす
          if (sec.drone && pos === 0 && barIn % 2 === 0) play(h, queue, view, desk, h.centre + h.degree(root - 14), at, level * 0.55, s * STEPS * 2.2);
          // 和音の刻み。卓が、いくつかをこだまに送る。ときどき 1 つを長いこだまに投げ込む
          if (sec.pattern.includes(pos)) {
            const notes = voicing(h, root, open);
            lastChord = notes;
            const seconds = spec.stab * s * (0.8 + 4 * open);
            const v = level * (0.75 + 0.25 * open) * random(0.92, 1.05);
            for (const n of notes) play(h, queue, view, track, n, at + random(-0.003, 0.003), v, seconds);
            if (rand() < sec.send) {
              const throwIn = rand() < 0.12 * sec.send;
              echo(h, queue, view, track, notes, at, v * 0.9, seconds, spec.delay * s, throwIn ? 0.86 : sec.feedback, spec.wow * (throwIn ? 1.6 : 1));
            }
          }
          // バネの残響: 8 小節ごとの終わりに、卓が低い音を素早く落とす
          if (sec.send > 0.3 && pos === STEPS - 2 && (done + 1) % 8 === 0)
            [4, 3, 1, 0].forEach((d, k) => play(h, queue, view, desk, h.centre + h.degree(root + d - 14), at + k * 0.03, level * 0.5, 0.9));
          // クリック: 卓が、その高さの音をこだまに投げ込む
          for (const index of clicks.splice(0)) {
            play(h, queue, view, desk, index, at, level * 0.8, s * 2);
            echo(h, queue, view, desk, [index], at, level * 0.8, s * 2, spec.delay * s, 0.78, spec.wow);
          }

          stepAt += s;
          pos++;
          if (pos < STEPS) continue;
          pos = 0;
          barIn++;
          done++;
          if (barIn < sec.bars) continue;
          barIn = 0;
          section++;
          if (section < sections.length) continue;
          // 終わり: 最後の和音を長いこだまに投げ込み、消えるのを待つ
          ending = true;
          const notes = lastChord.length > 0 ? lastChord : voicing(h, 0, 0.5);
          for (const n of notes) play(h, queue, view, FIRST, n, stepAt, level * 0.9, s * 6);
          echo(h, queue, view, FIRST, notes, stepAt, level * 0.9, s * 6, spec.delay * s, 0.8, spec.wow * 1.5);
          endAt = stepAt + 9;
        }
      });

      return {
        pointer(_x, y, height) {
          if (ending) return;
          clicks.push(pitchIndexAt(y, height, ctx.pitches().length));
        },
        draw(g, width, height) {
          view.draw(g, width, height);
          legend(g, GUIDE_BOTTOM);
          drawDesk(g, ctx, width, sections, shown.get());
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
  return movement;
}

// 上端: 1 小節の 16 分音符の箱（和音を刻む所を、トラックの台の色で）と今の和音。下に 2 台の役、その下に卓のつまみ（開き・送り・戻り）
function drawDesk(
  g: CanvasRenderingContext2D,
  ctx: MovementContext,
  width: number,
  sections: (Section & { pattern: number[] })[],
  now: { section: number; pos: number; track: number; root: number; open: number },
) {
  const sec = sections[now.section];
  const left = guideLeft(g, GUIDE_BOTTOM);
  const cell = clamp((width - left) / 2 / 22, 5, 10);
  let x = left;
  for (let k = 0; k < STEPS; k++) {
    const head = k % 4 === 0;
    g.fillStyle = k === now.pos ? "rgba(255, 255, 255, 0.9)" : sec.pattern.includes(k) ? ownerColor(now.track as 0 | 1, 0.75) : `rgba(255, 255, 255, ${head && sec.kick ? 0.3 : 0.14})`;
    g.fillRect(x, INFO_Y + (head ? 0 : 3), cell - 2, head ? 12 : 9);
    x += cell;
    if (k % 4 === 3) x += cell * 0.4;
  }
  g.font = "13px system-ui, sans-serif";
  g.textAlign = "left";
  g.fillStyle = "rgba(255, 255, 255, 0.7)";
  g.fillText(chordName(layout(ctx), now.root, now.open), x + 6, INFO_Y + 11);

  g.font = "11px system-ui, sans-serif";
  const roles = [now.track, 1 - now.track];
  x = left;
  roles.forEach((p, k) => {
    const text = `${p === 0 ? "I" : "II"}: ${t(ROLE[k])}`;
    g.fillStyle = ownerColor(p as 0 | 1, 0.85);
    g.fillText(text, x, INFO_Y + 30);
    x += g.measureText(text).width + 14;
  });

  x = left;
  const knobs: [L, number][] = [
    [{ ja: "開き", en: "open" }, now.open],
    [{ ja: "送り", en: "send" }, sec.send],
    [{ ja: "戻り", en: "feedback" }, sec.feedback],
  ];
  for (const [name, value] of knobs) {
    const label = t(name);
    g.fillStyle = "rgba(255, 255, 255, 0.55)";
    g.fillText(label, x, INFO_Y + 47);
    x += g.measureText(label).width + 5;
    g.fillStyle = "rgba(255, 255, 255, 0.15)";
    g.fillRect(x, INFO_Y + 40, 36, 6);
    g.fillStyle = "rgba(255, 255, 255, 0.6)";
    g.fillRect(x, INFO_Y + 40, 36 * clamp(value, 0, 1), 6);
    x += 48;
  }
}

// --- I. 刻み ---

const pulse = dubMovement({
  title: { ja: "I. 刻み", en: "I. Pulse" },
  duration: 200,
  nominal: 200,
  pulse: 0.92,
  delay: 3,
  stab: 1,
  wow: 2,
  patterns: [[2, 10], [3, 10], [2, 7, 10], [2, 6, 10, 14], [3, 6, 11]],
  level: (progress) => 0.24 + 0.06 * Math.sin(Math.PI * clamp(progress, 0, 1)),
  plan: () => {
    const away = pick([3, 5]);
    return [
      { bars: 4, chords: [0], track: FIRST, kick: true, hats: true, send: 0, feedback: 0.5, open: [0.4, 0.4] },
      { bars: 16, chords: [0], track: FIRST, kick: true, hats: true, send: 0.35, feedback: 0.55, open: [0.4, 0.5] },
      { bars: 4, chords: [0], track: FIRST, kick: false, hats: true, send: 0.9, feedback: 0.72, open: [0.5, 0.5] },
      { bars: 16, chords: [0, 0, away, away], track: FIRST, kick: true, hats: true, send: 0.45, feedback: 0.6, open: [0.5, 0.65] },
      { bars: 8, chords: [away], track: FIRST, kick: true, hats: true, send: 0.55, feedback: 0.62, open: [0.65, 0.7] },
      { bars: 4, chords: [away], track: FIRST, kick: false, hats: false, send: 0.95, feedback: 0.75, open: [0.7, 0.6] },
      // トラックと卓を交代する
      { bars: 16, chords: [0], track: SECOND, kick: true, hats: true, send: 0.45, feedback: 0.6, open: [0.6, 0.75] },
      { bars: 12, chords: [0, 0, 4, 4], track: SECOND, kick: true, hats: true, send: 0.5, feedback: 0.62, open: [0.75, 0.8] },
      { bars: 6, chords: [0], track: SECOND, kick: false, hats: false, send: 0.8, feedback: 0.7, open: [0.8, 0.5] },
    ];
  },
});

// --- II. 霧 ---

const fog = dubMovement({
  title: { ja: "II. 霧", en: "II. Fog" },
  duration: 180,
  nominal: 180,
  pulse: 0.55,
  delay: 4,
  stab: 3,
  wow: 6,
  patterns: [[0], [0, 10], [6], [0, 7], [2, 11]],
  level: (progress) => 0.2 + 0.06 * Math.sin(Math.PI * clamp(progress, 0, 1)),
  plan: () => [
    { bars: 6, chords: [0], track: "turns", kick: false, hats: false, drone: true, send: 0.7, feedback: 0.7, open: [0.5, 0.6] },
    { bars: 12, chords: [0, 0, 5, 5], track: "turns", kick: false, hats: false, drone: true, send: 0.8, feedback: 0.72, open: [0.6, 0.8] },
    { bars: 12, chords: [3, 3, 0, 0], track: "turns", kick: false, hats: false, drone: true, send: 0.85, feedback: 0.75, open: [0.8, 1] },
    { bars: 12, chords: [5, 4, 0, 0], track: "turns", kick: false, hats: false, drone: true, send: 0.8, feedback: 0.72, open: [1, 0.7] },
    { bars: 6, chords: [0], track: "turns", kick: false, hats: false, drone: true, send: 0.9, feedback: 0.78, open: [0.7, 0.4] },
  ],
});

// --- III. 開いていく ---

const opening = dubMovement({
  title: { ja: "III. 開いていく", en: "III. Opening" },
  duration: 200,
  nominal: 200,
  pulse: 0.92,
  delay: 3,
  stab: 1,
  wow: 3,
  patterns: [[2, 10], [2, 6, 10, 14], [3, 10], [2, 7, 10]],
  level: (progress) => 0.2 + 0.1 * clamp(progress * 1.2, 0, 1),
  plan: () => [
    { bars: 12, chords: [0], track: FIRST, kick: false, hats: false, send: 0.6, feedback: 0.6, open: [0, 0.12] },
    { bars: 16, chords: [0], track: FIRST, kick: true, hats: false, send: 0.45, feedback: 0.58, open: [0.12, 0.3] },
    { bars: 16, chords: [0, 0, 0, pick([3, 5])], track: FIRST, kick: true, hats: true, send: 0.5, feedback: 0.6, open: [0.3, 0.5] },
    { bars: 4, chords: [0], track: FIRST, kick: false, hats: true, send: 0.9, feedback: 0.72, open: [0.5, 0.55] },
    { bars: 16, chords: [0, 0, 3, 3], track: SECOND, kick: true, hats: true, send: 0.5, feedback: 0.62, open: [0.55, 0.85] },
    { bars: 12, chords: [0], track: SECOND, kick: true, hats: true, send: 0.65, feedback: 0.68, open: [0.85, 1] },
    { bars: 8, chords: [0], track: SECOND, kick: false, hats: false, send: 0.8, feedback: 0.72, open: [1, 0.3] },
  ],
});

export const twoEngineers: Sonata = {
  id: "engineers",
  composer: { ja: "二人の録音技師", en: "Two Recording Engineers" },
  credit: { ja: "二人の録音技師が連弾したら", en: "as if two recording engineers played it" },
  initials: "Eng. & Eng.",
  scale: AEOLIAN,
  root: "C",
  modes: [AEOLIAN, DORIAN, PHRYGIAN, MIXOLYDIAN],
  tuning: "old", // テープとダブの揺れる響きに
  movements: [pulse, fog, opening],
};
