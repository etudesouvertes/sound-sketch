import * as Tone from "tone";
import { t, type L } from "../i18n";
import { pitchIndexAt, type Scale, SCALES } from "../scales";
import {
  clamp,
  type Layout,
  layout,
  type Movement,
  type MovementContext,
  pendingQueue,
  pick,
  rand,
  random,
  scheduler,
  type Sonata,
  TICK,
  timed,
} from "../sonata/movement";
import { FIRST, fromLow, INFO_Y, legend, markView, noteName, ownerColor, play, SECOND, guideLeft } from "./common";

// 上端の案内の下端（音部記号・調号と重なるかを見るため）
const GUIDE_BOTTOM = INFO_Y + 46;

// 二人のコラ奏者が、2 台のピアノで連弾したら、という試み。コラ（西アフリカの 21 弦のハープ）の弾き方をピアノに移している。
// コラの曲は、12 拍（8 分の 12 拍子の 1 小節、付点 4 分で 4 拍）の短い周期を何度も回す。
// 回る伴奏の型（クンベング）では、親指の低い音が付点 4 分の 4 拍を刻み、人差し指の高い音が 2 つずつの 6 拍を刻むので、
// 3 と 2 が重なる（ヘミオラ）。その上で、速い連なり（ビリミンティンゴ）が高い所から流れ落ちる。
// 2 人で弾くときは、一方が伴奏の型を回し、もう一方が連なりを弾き、役を入れ替える。伴奏を 2 人で回すときは、
// もう一方が 1 つおきの隙間を埋めて、2 台で 1 本の流れを作る。
// I.   回る型: 1 人の型から始め、2 人目が隙間を埋め、連なりと型を交代しながら、和音の周期が主音から離れて戻る
// II.  歌: ゆっくり回る型の上で、一方が歌の旋律（長い音で高い所から降りてくる。装飾の短い音を前に付ける）を弾く。
//      途中で役を入れ替え、終わりの方では 2 小節ごとに歌い交わす
// III. 速まる: 2 人の型の噛み合わせから始めて、少しずつ速くなる。連なりの受け渡しが 2 周 → 1 周と短くなり、
//      最後は 2 人が 3 度で重ねて流れ落ち、型に戻って止まる
//
// 音階は F の長音階。和音は 3 和音で、5 度が完全 5 度になる音だけを根音にするので、旋法を変えても崩れない（設定で選べる）

const MAJOR: Scale = { id: "major", group: "", name: { ja: "長音階（イオニアン）", en: "Major (Ionian)" }, steps: [0, 2, 4, 5, 7, 9, 11] };
const MIXOLYDIAN: Scale = { id: "mixolydian", group: "", name: { ja: "ミクソリディアン", en: "Mixolydian" }, steps: [0, 2, 4, 5, 7, 9, 10] };
const LYDIAN = SCALES.find((s) => s.id === "lydian")!;
const DORIAN: Scale = { id: "dorian", group: "", name: { ja: "ドリアン", en: "Dorian" }, steps: [0, 2, 3, 5, 7, 9, 10] };

// --- 和音 ---

const mode = () => twoKoras.scale;
const semi = (d: number) => mode().steps[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
const perfectFifth = (root: number) => semi(root + 4) - semi(root) === 7;
// 5 度が減 5 度になる根音は、1 つ上（なければ 1 つ下）の度数に置き換える
const fit = (d: number) => [d, d + 1, d - 1].map((x) => ((x % 7) + 7) % 7).find((x) => x === 0 || perfectFifth(x)) ?? 0;

function chordName(h: Layout, root: number): string {
  const letter = noteName(h, fromLow(h, root));
  return `${letter}${semi(root + 2) - semi(root) === 3 ? "m" : ""}`;
}

// 和音の周期（1 拍に 1 つの根音、4 拍で 1 周）。長音階での呼び方
const [I, ii, IV, V, vi] = [0, 1, 3, 4, 5];
const CYCLES = {
  home: [I, I, IV, V], // 主音から下属音・属音へ
  turn: [I, IV, I, V],
  away: [vi, vi, IV, V], // 主音を離れて
  lift: [IV, IV, I, V],
  sway: [ii, V, I, I],
  rest: [I, I, I, I],
};
const rootAt = (cycle: number[], beat: number) => fit(cycle[beat % cycle.length]);

// --- 弾き方 ---

// 役。full は 1 人で回す伴奏の型（低い音・中の音・高い音）、fill はもう一方の型の隙間を埋める高い音、
// sparse は歌の下でまばらに回す型、run は速い連なり、runLow は相手の連なりの 3 度下で重ねる（低い音の刻み付き）、song は歌
type Role = "rest" | "full" | "fill" | "sparse" | "run" | "runLow" | "song";
const ROLE_NAMES: Record<Role, L> = {
  rest: { ja: "休み", en: "rest" },
  full: { ja: "クンベング（回る伴奏）", en: "kumbengo (the turning pattern)" },
  fill: { ja: "クンベング（隙間を埋める）", en: "kumbengo (filling the gaps)" },
  sparse: { ja: "クンベング（まばらに）", en: "kumbengo (sparse)" },
  run: { ja: "ビリミンティンゴ（速い連なり）", en: "birimintingo (fast runs)" },
  runLow: { ja: "ビリミンティンゴ（3 度下で）", en: "birimintingo (a third below)" },
  song: { ja: "歌", en: "song" },
};
type Section = { roles: [Role, Role]; cycle: number[]; cycles: number };

const PULSES = 12;
const BEAT = 3; // 1 拍（付点 4 分）の 8 分音符の数

// 伴奏の型の、高い音の候補（根音からの度数）。full は 6 つの 8 分音符の頭（2 つおき）に、fill は残りの 6 つに置く
const TREBLE = [7, 9, 11, 14];
const FILL = [9, 11, 14, 16];
const newLine = () => Array.from({ length: PULSES / 2 }, () => Math.floor(rand() * 4));

// 速い連なり: 1 周（24 の 16 分音符）。高い所から、1 段ずつか「2 段下りて 1 段上る」形で流れ落ち、ところどころ間を空ける。
// 値は画面の一番下の主音から数えた位置、null は休み。最後は和音の音に着く
function cascade(h: Layout, cycle: number[], from: number): (number | null)[] {
  const slots: (number | null)[] = [];
  let at = from;
  const floor = h.centre - 3;
  while (slots.length < PULSES * 2) {
    const shape = pick(["scale", "zigzag", "pairs"] as const);
    const length = 6 + Math.floor(rand() * 7);
    for (let k = 0; k < length && slots.length < PULSES * 2; k++) {
      slots.push(at);
      if (shape === "scale") at -= 1;
      else if (shape === "zigzag") at += k % 2 === 0 ? -2 : 1;
      else if (k % 2 === 1) at -= 1; // 同じ音を 2 度ずつ
      if (at < floor) at += 7;
    }
    // 間を空けて、少し高い所からまた落ちる
    const gap = pick([1, 2, 2, 3]);
    for (let k = 0; k < gap && slots.length < PULSES * 2; k++) slots.push(null);
    at = Math.min(at + pick([3, 4, 5]), h.centre + 10);
  }
  // 最後の音を、最後の拍の和音の音に寄せる
  let last = slots.length - 1;
  while (last >= 0 && slots[last] === null) last--;
  if (last >= 0) {
    const root = rootAt(cycle, 3);
    const tones = [0, 2, 4].map((d) => (((root + d) % 7) + 7) % 7);
    let n = slots[last]!;
    while (!tones.includes((((n - h.lowRoot) % 7) + 7) % 7)) n--;
    slots[last] = n;
  }
  return slots;
}

// 歌の旋律: 2 周（24 の 8 分音符）の句。高い和音の音から始め、長い音で 1 段ずつ降りて（ときどき 1 段上がって）、
// 句の終わりに和音の音に着き、残りは休む
type SongNote = { at: number; index: number; length: number };
function songPhrase(h: Layout, cycle: number[]): SongNote[] {
  const notes: SongNote[] = [];
  const startRoot = rootAt(cycle, 0);
  let index = fromLow(h, startRoot + pick([9, 11, 14]));
  index = clamp(index, h.centre + 2, h.centre + 10);
  let at = 0;
  while (at < 19) {
    const length = pick([3, 3, 2, 1, 1, 4, 6]);
    notes.push({ at, index, length: Math.min(length, 21 - at) });
    at += length;
    index += pick([-1, -1, -1, -2, 1]);
  }
  // 句の終わりは、そのときの和音の音に
  const lastNote = notes.at(-1)!;
  const root = rootAt(cycle, Math.floor(lastNote.at / BEAT));
  const tones = [0, 2, 4].map((d) => (root + d) % 7);
  while (!tones.includes((((lastNote.index - h.lowRoot) % 7) + 7) % 7)) lastNote.index--;
  lastNote.length = Math.max(lastNote.length, 3);
  return notes;
}

// --- 楽章の仕組み: 12 拍の周期を回し、区切りごとに 2 台の役と和音の周期を変える ---

type CycleSpec = {
  title: L;
  duration: number;
  nominal: number; // 区切りの周期の数を決めたときの長さ（?short のときは、周期の数をこの比で減らす）
  plan: () => Section[];
  pulse: (ctx: MovementContext) => number; // 1 拍（8 分音符）の長さ（秒）
  speed?: (progress: number) => number; // 速さの倍率（曲の進みに応じて）
  level: (progress: number) => number;
};

function cycleMovement(spec: CycleSpec): Movement {
  const movement: Movement = {
    title: spec.title,
    duration: spec.duration,
    start(ctx) {
      let endAt = Infinity;
      const queue = pendingQueue(ctx);
      const view = markView(ctx);
      const scale = movement.duration / spec.nominal;
      const sections = spec.plan().map((s) => ({ ...s, cycles: Math.max(s.cycles > 2 ? 2 : 1, Math.round(s.cycles * scale)) }));
      const totalCycles = sections.reduce((a, s) => a + s.cycles, 0);

      let section = 0;
      let cycleIn = 0; // 区切りの中の周期
      let done = 0; // 曲の頭からの周期の数
      let pulse = 0;
      let pulseAt = Tone.now() + 0.4;
      let ending = false;
      // 台ごとの、伴奏の型の高い音の並びと、この周期の連なり・歌の句
      const lines = [newLine(), newLine()];
      let runs: (number | null)[][] = [[], []];
      let songs: Map<number, SongNote>[] = [new Map(), new Map()];
      const extra = new Map<number, number[]>(); // クリックで足した連なり（16 分音符の位置 → 音）
      const shown = timed({ section: 0, pulse: 0, root: 0, speed: 1 });

      const beginCycle = (h: Layout) => {
        const { roles, cycle } = sections[section];
        // 2 周ごとに、伴奏の型の高い音を 1 つ動かす
        if (done > 0 && done % 2 === 0) {
          for (const line of lines) {
            const k = Math.floor(rand() * line.length);
            line[k] = clamp(line[k] + pick([-1, 1]), 0, 3);
          }
        }
        runs = [[], []];
        const leader = roles.indexOf("run");
        if (leader >= 0) runs[leader] = cascade(h, cycle, h.centre + 7 + Math.floor(rand() * 3));
        roles.forEach((role, p) => {
          if (role === "runLow") runs[p] = (leader >= 0 ? runs[leader] : cascade(h, cycle, h.centre + 5)).map((n) => (n === null ? null : n - 2));
          // 歌は 2 周で 1 句。区切りの偶数番目の周期で作り、次の周期はその続き
          if (role === "song" && cycleIn % 2 === 0) songs[p] = new Map(songPhrase(h, cycle).map((n) => [n.at, n]));
        });
      };

      const loop = scheduler(ctx, (time) => {
        queue.flush(time);
        while (!ending && pulseAt < time + TICK) {
          const h = layout(ctx);
          const progress = done / totalCycles;
          const speed = spec.speed?.(progress) ?? 1;
          const s = spec.pulse(ctx) / speed;
          const { roles, cycle } = sections[section];
          if (pulse === 0) beginCycle(h);
          const beat = Math.floor(pulse / BEAT);
          const root = rootAt(cycle, beat);
          const level = spec.level(progress);
          shown.set(pulseAt, { section, pulse, root, speed });

          roles.forEach((role, p) => {
            const at = pulseAt + random(-0.006, 0.006);
            if (role === "full" || role === "sparse" || role === "runLow") {
              // 低い音: 付点 4 分の頭。1 拍目と 3 拍目は根音、2 拍目と 4 拍目は 5 度
              if (pulse % BEAT === 0) play(h, queue, view, p, fromLow(h, root + (beat % 2 === 0 ? 0 : 4)), at, level * 1.05, s * BEAT * 1.2);
            }
            if (role === "full") {
              // 高い音: 2 つおき（2 拍子に聞こえる）。残りの 8 分音符には中の音
              if (pulse % 2 === 0) play(h, queue, view, p, fromLow(h, root + TREBLE[lines[p][pulse / 2]]), at, level * 0.85, s * 2);
              else if (pulse % BEAT !== 0) play(h, queue, view, p, fromLow(h, root + (pulse % 4 === 1 ? 4 : 7)), at, level * 0.6, s * 1.5);
            }
            if (role === "fill" && pulse % 2 === 1) play(h, queue, view, p, fromLow(h, root + FILL[lines[p][(pulse - 1) / 2]]), at, level * 0.7, s * 2);
            if (role === "sparse" && pulse % 4 === 0) play(h, queue, view, p, fromLow(h, root + TREBLE[lines[p][pulse / 2]]), at, level * 0.6, s * 4);
            if (role === "run" || role === "runLow") {
              for (const half of [0, 1]) {
                const n = runs[p][pulse * 2 + half];
                if (n === null || n === undefined) continue;
                const accent = half === 0 && pulse % BEAT === 0 ? 1.2 : 1;
                play(h, queue, view, p, n, at + (half * s) / 2, level * 0.8 * accent * random(0.9, 1.05), s * 1.2);
              }
            }
            if (role === "song") {
              const n = songs[p].get((cycleIn % 2) * PULSES + pulse);
              if (n) {
                // 長い音には、1 段上の短い装飾の音を前に付ける
                if (n.length >= 3 && rand() < 0.5) play(h, queue, view, p, n.index + 1, at - 0.07, level * 0.55, 0.12);
                play(h, queue, view, p, n.index, at, level * 1.25, s * n.length * 1.3);
              }
            }
          });
          // クリックで足した連なり（伴奏を回している方の台で）
          for (const half of [0, 1]) {
            const notes = extra.get(pulse * 2 + half);
            if (!notes) continue;
            extra.delete(pulse * 2 + half);
            const p = roles[SECOND] === "run" || roles[SECOND] === "song" ? FIRST : SECOND;
            for (const n of notes) play(h, queue, view, p, n, pulseAt + (half * s) / 2, level * 0.8, s * 1.2);
          }

          pulseAt += s;
          pulse++;
          if (pulse < PULSES) continue;
          pulse = 0;
          cycleIn++;
          done++;
          if (cycleIn < sections[section].cycles) continue;
          cycleIn = 0;
          section++;
          if (section < sections.length) continue;
          // 終わり: 次の周期の頭で、2 台が主音の和音を鳴らし、低い主音を長く残す
          ending = true;
          for (const d of [7, 9, 11, 14]) play(h, queue, view, FIRST, fromLow(h, d), pulseAt, 0.34, 4);
          for (const d of [0, 4, 7]) play(h, queue, view, SECOND, fromLow(h, d), pulseAt, 0.34, 4);
          play(h, queue, view, SECOND, fromLow(h, 0) - h.perOctave, pulseAt, 0.32, 5);
          endAt = pulseAt + 5;
        }
      });

      return {
        // クリックした高さから、短い連なりを流し落とす（次の 16 分音符から、6 つ）
        pointer(_x, y, height) {
          if (ending) return;
          const top = pitchIndexAt(y, height, ctx.pitches().length);
          const from = pulse * 2;
          for (let k = 0; k < 6; k++) extra.set((from + k) % (PULSES * 2), [top - k]);
        },
        draw(g, width, height) {
          view.draw(g, width, height);
          legend(g, GUIDE_BOTTOM);
          drawCycle(g, ctx, sections, shown.get(), spec.speed !== undefined);
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

// 上端: 12 拍を 3 つずつ 4 組の箱で並べ（付点 4 分の頭は少し高く）、今の拍を明るくする。横に和音、下の行に 2 台の役
function drawCycle(
  g: CanvasRenderingContext2D,
  ctx: MovementContext,
  sections: Section[],
  now: { section: number; pulse: number; root: number; speed: number },
  showSpeed: boolean,
) {
  const roles = sections[now.section].roles;
  let x = guideLeft(g, GUIDE_BOTTOM);
  for (let k = 0; k < PULSES; k++) {
    const head = k % BEAT === 0;
    g.fillStyle = `rgba(255, 255, 255, ${k === now.pulse ? 0.9 : head ? 0.35 : 0.18})`;
    g.fillRect(x, INFO_Y + (head ? 0 : 3), 10, head ? 12 : 9);
    x += 12;
    if (k % BEAT === BEAT - 1) x += 6;
  }
  g.font = "13px system-ui, sans-serif";
  g.textAlign = "left";
  g.fillStyle = "rgba(255, 255, 255, 0.7)";
  const chord = chordName(layout(ctx), now.root);
  g.fillText(chord, x + 6, INFO_Y + 11);
  if (showSpeed) {
    g.fillStyle = "rgba(255, 255, 255, 0.45)";
    g.fillText(`×${now.speed.toFixed(2)}`, x + 6 + g.measureText(chord).width + 12, INFO_Y + 11);
  }
  g.font = "11px system-ui, sans-serif";
  let y = INFO_Y + 30;
  roles.forEach((role, p) => {
    g.fillStyle = ownerColor(p as 0 | 1, role === "rest" ? 0.3 : 0.85);
    g.fillText(`${p === 0 ? "I" : "II"}: ${t(ROLE_NAMES[role])}`, guideLeft(g, GUIDE_BOTTOM), y);
    y += 14;
  });
}

// 1 拍（8 分音符）の長さ。テンポの設定の 4 分の 3 を付点 4 分の速さにする（132 なら付点 4 分がおよそ 99）
const pulseOf = (ctx: MovementContext, factor: number) => 60 / (ctx.bpm() * 0.75 * factor * BEAT);

// --- I. 回る型 ---

const turning = cycleMovement({
  title: { ja: "I. 回る型", en: "I. Kumbengo" },
  duration: 200,
  nominal: 200,
  pulse: (ctx) => pulseOf(ctx, 1),
  level: (progress) => 0.2 + 0.12 * Math.sin(Math.PI * clamp(progress, 0, 1)),
  plan: () => [
    { roles: ["full", "rest"], cycle: CYCLES.home, cycles: 6 },
    { roles: ["full", "fill"], cycle: CYCLES.home, cycles: 12 },
    { roles: ["full", "run"], cycle: CYCLES.home, cycles: 10 },
    { roles: ["run", "full"], cycle: pick([CYCLES.away, CYCLES.sway]), cycles: 10 },
    { roles: ["full", "fill"], cycle: CYCLES.lift, cycles: 8 },
    { roles: ["full", "run"], cycle: CYCLES.away, cycles: 8 },
    { roles: ["run", "full"], cycle: CYCLES.turn, cycles: 8 },
    { roles: ["full", "fill"], cycle: CYCLES.home, cycles: 8 },
    { roles: ["full", "rest"], cycle: CYCLES.home, cycles: 2 },
  ],
});

// --- II. 歌 ---

const song = cycleMovement({
  title: { ja: "II. 歌", en: "II. Song" },
  duration: 180,
  nominal: 180,
  pulse: (ctx) => pulseOf(ctx, 0.55),
  level: (progress) => 0.18 + 0.1 * Math.sin(Math.PI * clamp(progress, 0, 1)),
  plan: () => {
    const sections: Section[] = [
      { roles: ["rest", "sparse"], cycle: CYCLES.home, cycles: 4 },
      { roles: ["song", "sparse"], cycle: CYCLES.home, cycles: 6 },
      { roles: ["song", "sparse"], cycle: CYCLES.lift, cycles: 4 },
      { roles: ["sparse", "song"], cycle: CYCLES.away, cycles: 6 },
      { roles: ["sparse", "song"], cycle: CYCLES.sway, cycles: 4 },
    ];
    // 終わりの方では、2 周（1 句）ごとに歌い手を入れ替えて、歌い交わす
    for (let k = 0; k < 4; k++) sections.push({ roles: k % 2 === 0 ? ["song", "sparse"] : ["sparse", "song"], cycle: k < 2 ? CYCLES.turn : CYCLES.home, cycles: 2 });
    sections.push({ roles: ["sparse", "sparse"], cycle: CYCLES.rest, cycles: 2 });
    return sections;
  },
});

// --- III. 速まる ---

const quickening = cycleMovement({
  title: { ja: "III. 速まる", en: "III. Quickening" },
  duration: 120,
  nominal: 120,
  pulse: (ctx) => pulseOf(ctx, 1),
  speed: (progress) => 0.9 + 0.5 * clamp(progress, 0, 1) ** 1.4,
  level: (progress) => 0.22 + 0.14 * clamp(progress, 0, 1),
  plan: () => {
    const sections: Section[] = [{ roles: ["full", "fill"], cycle: CYCLES.home, cycles: 8 }];
    // 連なりの受け渡し: 2 周ずつ 4 回、1 周ずつ 8 回。和音の周期も主音から離れる
    for (let k = 0; k < 4; k++) sections.push({ roles: k % 2 === 0 ? ["run", "full"] : ["full", "run"], cycle: k < 2 ? CYCLES.home : CYCLES.lift, cycles: 2 });
    for (let k = 0; k < 8; k++) sections.push({ roles: k % 2 === 0 ? ["run", "full"] : ["full", "run"], cycle: k < 4 ? CYCLES.away : CYCLES.sway, cycles: 1 });
    // 2 人が 3 度で重ねて流れ落ち、型に戻って止まる
    sections.push({ roles: ["run", "runLow"], cycle: CYCLES.turn, cycles: 6 });
    sections.push({ roles: ["full", "fill"], cycle: CYCLES.home, cycles: 6 });
    return sections;
  },
});

export const twoKoras: Sonata = {
  id: "koras",
  composer: { ja: "二人のコラ奏者", en: "Two Kora Players" },
  credit: { ja: "二人のコラ奏者が連弾したら", en: "as if two kora players played it" },
  initials: "Ko. & Ko.",
  scale: MAJOR,
  root: "F",
  modes: [MAJOR, LYDIAN, MIXOLYDIAN, DORIAN],
  tuning: "loose", // コラの弦は、耳で合わせる
  movements: [turning, song, quickening],
};
