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

// 二人のドラマーが、2 台のピアノで連弾したら、という試み。ピアノを打楽器として使う。
// 音は短く、同じ高さを連打し、旋律はほとんどない。ドラムの 1 つ 1 つを、決まった高さの音（和音の形）に割り当てる。
// キックは低い主音、タムは 5 度・主音・3 度、スネアは隣り合う 2 音、ハイハットとシンバルは高い所の 2 音。
// タムの高さは区切りごとに移るので（主音 → IV → V など）、ドラムだけで和音が進むように聞こえる。
// ピアノ I は、ジャズのドラマー: ライドの 4 ビート（8 分音符は跳ねる）、合間に落とすキック、タムで旋律を作り、動機を育てるソロ。
// ピアノ II は、アフロビートのドラマー: ハイハット・キック・スネア・ゴースト・タムの手足を 1 本ずつ重ねる刻み（16 分音符がわずかに跳ねる）、
// 3 つずつの打点を 4 拍子に重ねるソロ。
// I.   重ね: ピアノ II が手足を 1 本ずつ重ねて刻みを作り、ピアノ I がライドで加わり、タムの旋律、ソロを交代して、最後は 1 本ずつ外す
// II.  ワルツ: ピアノ I は 3/4、ピアノ II は 4/4。4 小節と 3 小節で頭が揃う。途中で拍子を入れ替え、最後は 2 人とも 3/4 で揃う
// III. 揃う: 4 小節ずつのソロの交代が 2 小節、1 小節と短くなり、少しずつ速くなる。ピアノ I が 5/4 で崩したあと、
//      2 台で同じ打点（キメ）を打ち、2 人のソロからシンバルで終わる
//
// 音階は D のドリアン（設定で選べる）。タムの高さは主音・IV・V・VI の上に組むので、どの旋法でも崩れない

const MIXOLYDIAN: Scale = { id: "mixolydian", group: "", name: { ja: "ミクソリディアン", en: "Mixolydian" }, steps: [0, 2, 4, 5, 7, 9, 10] };
const PHRYGIAN: Scale = { id: "phrygian", group: "", name: { ja: "フリジア", en: "Phrygian" }, steps: [0, 1, 3, 5, 7, 8, 10] };

// --- ドラムの組: ドラムごとの高さ（度数。7 が画面の中ほどの主音に、区切りのタムの主音を足した所）、長さ、強さ ---

type Drum = "kick" | "floor" | "low" | "high" | "snare" | "ghost" | "hat" | "open" | "ride" | "crash";
const KIT: Record<Drum, { at: [number, number][]; seconds: number; level: number }> = {
  kick: { at: [[0, 1], [-7, 0.55]], seconds: 0.4, level: 1.15 },
  floor: { at: [[4, 1]], seconds: 0.32, level: 0.95 },
  low: { at: [[7, 1]], seconds: 0.24, level: 0.9 },
  high: { at: [[9, 1]], seconds: 0.2, level: 0.85 },
  snare: { at: [[11, 1], [12, 0.8]], seconds: 0.1, level: 0.9 },
  ghost: { at: [[11, 1]], seconds: 0.06, level: 0.35 },
  hat: { at: [[17, 0.8], [18, 1]], seconds: 0.05, level: 0.4 },
  open: { at: [[17, 0.8], [18, 1]], seconds: 0.4, level: 0.5 },
  ride: { at: [[19, 1]], seconds: 0.7, level: 0.42 },
  crash: { at: [[0, 0.9], [14, 0.7], [16, 0.7], [18, 0.9], [21, 1]], seconds: 1.8, level: 0.75 },
};
const kitIndex = (h: Layout, tonic: number, degree: number) => h.centre + h.degree(degree - 7 + tonic);

function strike(h: Layout, queue: Queue, view: View, piano: number, tonic: number, drum: Drum, time: number, velocity: number) {
  const k = KIT[drum];
  for (const [d, scale] of k.at) play(h, queue, view, piano, kitIndex(h, tonic, d), time, Math.min(1, velocity * k.level * scale), k.seconds);
}

// 跳ね: ピアノ I は 8 分音符の裏（ジャズ）を、ピアノ II は 16 分音符の裏（アフロビート）を少し遅らせる
const lilt = (p: number, pos: number, s: number) => (p === FIRST ? (pos % 4 === 2 ? s * 0.32 : 0) : pos % 2 === 1 ? s * 0.12 : 0);

// --- 1 小節の打点（16 分音符ごとの、ドラムと強さの並び）---

type Hit = { drum: Drum; v: number };
type Bar = Hit[][];
const empty = (len: number): Bar => Array.from({ length: len }, () => []);

// ライドの 4 ビート: 拍の頭と、2 拍目・4 拍目の前の跳ねた 8 分音符。2 拍目と 4 拍目にハイハット（足）
function ride(len: number, light = 1): Bar {
  const bar = empty(len);
  for (let k = 0; k < len; k++) {
    if (k % 4 === 0) bar[k].push({ drum: "ride", v: (k % 8 === 0 ? 0.8 : 1) * light });
    if (k % 8 === 6) bar[k].push({ drum: "ride", v: 0.7 * light });
    if (k % 8 === 4) bar[k].push({ drum: "hat", v: 0.9 });
  }
  return bar;
}

// ジャズの刻み: ライドに、合間のスネアと、ときどき落とすキック（小節ごとに変わる）
function swingBar(len: number): Bar {
  const bar = ride(len);
  const comps = Math.floor(rand() * 3);
  for (let n = 0; n < comps; n++) bar[Math.floor(rand() * len)].push({ drum: rand() < 0.5 ? "ghost" : "snare", v: random(0.5, 0.8) });
  if (rand() < 0.4) bar[pick([3, 6, 7, 10, 11, 14].filter((k) => k < len))].push({ drum: "kick", v: random(0.7, 0.95) });
  return bar;
}

// アフロビートの手足の型（楽章ごとに 1 つ。区切りが変わっても同じ型を重ねたり外したりする）
type Limbs = { kick: number[]; snare: number[]; ghosts: number[]; toms: [number, Drum][]; open: number };
function newLimbs(): Limbs {
  return {
    kick: pick([[0, 10], [0, 7, 10], [0, 3, 10, 13], [0, 6, 10]]),
    snare: pick([[4, 12], [4, 11, 12], [7, 12], [4, 9, 14]]),
    ghosts: pick([[2, 9, 15], [5, 11, 13], [1, 7, 15], [3, 6, 14]]),
    toms: pick([[[13, "high"], [14, "low"], [15, "floor"]], [[11, "low"], [15, "floor"]], [[6, "high"], [14, "floor"]]] as [number, Drum][][]),
    open: pick([6, 14, 10]),
  };
}

// 手足を layers 本まで重ねる: ハイハット → キック → スネア → ゴースト → タム
function afro(len: number, layers: number, limbs: Limbs): Bar {
  const bar = empty(len);
  const at = (list: number[]) => list.filter((k) => k < len);
  if (layers >= 1) for (let k = 0; k < len; k++) bar[k].push(k === limbs.open % len ? { drum: "open", v: 0.9 } : { drum: "hat", v: k % 4 === 0 ? 1 : k % 2 === 0 ? 0.75 : 0.5 });
  if (layers >= 2) for (const k of at(limbs.kick)) bar[k].push({ drum: "kick", v: k === 0 ? 1 : 0.85 });
  if (layers >= 3) for (const k of at(limbs.snare)) bar[k].push({ drum: "snare", v: 1 });
  if (layers >= 4) for (const k of at(limbs.ghosts)) bar[k].push({ drum: "ghost", v: 1 });
  if (layers >= 5) for (const [k, d] of limbs.toms) if (k < len) bar[k].push({ drum: d, v: 0.8 });
  return bar;
}

// タムの旋律（動機）: 4〜6 打。高いタムから降りてくる形が多い
type Motif = { at: number; drum: Drum; v: number }[];
const LADDER: Drum[] = ["high", "low", "floor", "kick"];
function newMotif(len: number): Motif {
  const count = 4 + Math.floor(rand() * 3);
  const slots = new Set<number>([0]);
  while (slots.size < count) slots.add(rand() < 0.75 ? 2 * Math.floor(rand() * (len / 2)) : Math.floor(rand() * len));
  let rung = 0;
  return [...slots]
    .sort((a, b) => a - b)
    .map((at, n) => {
      const drum = n > 0 && rand() < 0.15 ? "snare" : LADDER[rung];
      rung = clamp(rung + pick([1, 1, 0, -1]), 0, 3);
      return { at, drum, v: at % 4 === 0 ? 1 : random(0.7, 0.9) };
    });
}
// 動機を 1 小節ごとに育てる: そのまま繰り返す・2 つずらす・高低を裏返す・1 打足す・1 打減らす
function develop(m: Motif, len: number): Motif {
  const op = pick(["repeat", "repeat", "shift", "flip", "add", "drop"] as const);
  if (op === "shift") return m.map((x) => ({ ...x, at: (x.at + 2) % len })).sort((a, b) => a.at - b.at);
  if (op === "flip") return m.map((x) => ({ ...x, drum: x.drum === "high" ? "floor" : x.drum === "floor" ? "high" : x.drum }));
  if (op === "add" && m.length < 8) {
    const at = Math.floor(rand() * len);
    if (!m.some((x) => x.at === at)) return [...m, { at, drum: pick(LADDER.slice(0, 3)), v: 0.75 }].sort((a, b) => a.at - b.at);
  }
  if (op === "drop" && m.length > 3) return m.filter((_, n) => n !== 1 + Math.floor(rand() * (m.length - 1)));
  return m;
}
function motifBar(len: number, m: Motif): Bar {
  const bar = empty(len);
  for (let k = 4; k < len; k += 8) bar[k].push({ drum: "hat", v: 0.8 });
  for (const x of m) if (x.at < len) bar[x.at].push({ drum: x.drum, v: x.v });
  return bar;
}

// ピアノ I のソロ: 育てた動機に、ゴーストを散らし、2 小節目の最後の拍はスネアの連打を強めていく
function swingSolo(len: number, m: Motif, barNo: number): Bar {
  const bar = motifBar(len, m);
  for (let k = 0; k < len; k++) if (bar[k].length === 0 && rand() < 0.25) bar[k].push({ drum: "ghost", v: 1 });
  if (barNo % 2 === 0) bar[0].push({ drum: "crash", v: 0.7 });
  if (barNo % 2 === 1) for (let k = len - 4; k < len; k++) bar[k] = [{ drum: k === len - 1 ? "floor" : "snare", v: 0.55 + 0.12 * (k - len + 4) }];
  return bar;
}

// ピアノ II のソロ: キックとハイハットの上に、3 つずつのタムの打点（4 拍子に 3 の並びが重なる）。並びの頭は小節ごとにずれる
function afroSolo(len: number, limbs: Limbs, barNo: number): Bar {
  const bar = afro(len, 2, limbs);
  const offset = barNo % 3;
  let n = 0;
  for (let k = offset; k < len; k += 3) bar[k].push({ drum: ["high", "low", "floor"][n++ % 3] as Drum, v: n % 2 === 1 ? 1 : 0.75 });
  if (barNo % 4 === 3) bar[len - 2].push({ drum: "snare", v: 1 });
  return bar;
}

// --- 区切り: 2 台の役と拍子（1 小節の 16 分音符の数）と、タムの主音（度数） ---

type Role = "rest" | "groove" | "comp" | "motif" | "solo" | "kicks";
type Part = { role: Role; len?: number; layers?: number };
type Section = { parts: [Part, Part]; bars: number; tonic: number }; // bars は 4/4 の小節の数で数えた長さ
const lenOf = (part: Part) => part.len ?? 16;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number) => (a * b) / gcd(a, b);

const ROLE_NAMES: Record<Role, [L, L]> = {
  rest: [
    { ja: "休み", en: "rest" },
    { ja: "休み", en: "rest" },
  ],
  groove: [
    { ja: "ライドの 4 ビート", en: "swing on the ride" },
    { ja: "手足を重ねた刻み", en: "layered limbs" },
  ],
  comp: [
    { ja: "ライドで支える", en: "keeping time on the ride" },
    { ja: "ハイハットとキックで支える", en: "keeping time on hi-hat and kick" },
  ],
  motif: [
    { ja: "タムの旋律", en: "melodic toms" },
    { ja: "タムの旋律", en: "melodic toms" },
  ],
  solo: [
    { ja: "ソロ（動機を育てる）", en: "solo (growing a motif)" },
    { ja: "ソロ（3 つずつの打点）", en: "solo (accents in threes)" },
  ],
  kicks: [
    { ja: "キメ（2 台で同じ打点）", en: "hits together" },
    { ja: "キメ（2 台で同じ打点）", en: "hits together" },
  ],
};
const METERS: Record<number, string> = { 12: "3/4", 16: "4/4", 20: "5/4" };

type KitSpec = {
  title: L;
  duration: number;
  nominal: number; // 区切りの長さを決めたときの長さ（?short のときは、この比で縮める）
  pulse: number; // テンポの設定に掛ける倍率
  speed?: (progress: number) => number;
  level: (progress: number) => number;
  plan: () => Section[];
};

function kitMovement(spec: KitSpec): Movement {
  const movement: Movement = {
    title: spec.title,
    duration: spec.duration,
    start(ctx) {
      let endAt = Infinity;
      const queue = pendingQueue(ctx);
      const view = markView(ctx);
      const scale = movement.duration / spec.nominal;
      const sections = spec.plan().map((s) => {
        const unit = lcm(lenOf(s.parts[0]), lenOf(s.parts[1]));
        return { ...s, steps: Math.max(1, Math.round((s.bars * 16 * scale) / unit)) * unit };
      });
      const totalSteps = sections.reduce((a, s) => a + s.steps, 0);
      const limbs = newLimbs();
      const figure = pick([[0, 3, 6, 10, 12], [0, 3, 6, 8, 11, 14], [0, 2, 6, 7, 10, 14]]);

      let section = 0;
      let stepIn = 0; // 区切りの中の 16 分音符
      let done = 0; // 曲の頭からの 16 分音符
      let stepAt = Tone.now() + 0.4;
      let ending = false;
      const bars: Bar[] = [[], []];
      const barNo = [0, 0];
      const motifs: Motif[] = [newMotif(16), newMotif(16)];
      let hits: number[][] = [[], []];
      const clicks: { index: number; left: number }[] = [];
      const shown = timed({ section: 0, pos: [0, 0], hits: [[], []] as number[][] });

      const newBar = (p: number, part: Part, len: number): Bar => {
        const n = barNo[p]++;
        if (part.role === "motif" || part.role === "solo") motifs[p] = n === 0 && rand() < 0.5 ? newMotif(len) : develop(motifs[p], len); // 区切りが変わっても、半分は前の動機を育て続ける
        switch (part.role) {
          case "groove":
            return p === FIRST ? swingBar(len) : afro(len, part.layers ?? 5, limbs);
          case "comp":
            return p === FIRST ? ride(len, 0.6) : afro(len, 2, limbs);
          case "motif":
            return motifBar(len, motifs[p]);
          case "solo":
            return p === FIRST ? swingSolo(len, motifs[p], n) : afroSolo(len, limbs, n);
          case "kicks": {
            const bar = empty(len);
            for (const k of figure) if (k < len) bar[k].push({ drum: k === 0 ? "crash" : "snare", v: 1 }, { drum: "kick", v: 1 });
            if (p === SECOND) for (let k = 0; k < len; k += 2) bar[k].push({ drum: "hat", v: 0.5 });
            return bar;
          }
          default:
            return empty(len);
        }
      };

      const loop = scheduler(ctx, (time) => {
        queue.flush(time);
        while (!ending && stepAt < time + TICK) {
          const h = layout(ctx);
          const progress = done / totalSteps;
          const s = 60 / (ctx.bpm() * spec.pulse * (spec.speed?.(progress) ?? 1) * 4);
          const { parts, tonic } = sections[section];
          const level = spec.level(progress);
          if (stepIn === 0) {
            hits = parts.map((part) => Array(lenOf(part)).fill(0));
            barNo[0] = barNo[1] = 0;
          }
          const pos = parts.map((part) => stepIn % lenOf(part));
          parts.forEach((part, p) => {
            if (pos[p] === 0) bars[p] = newBar(p, part, lenOf(part));
            hits[p][pos[p]] = 0;
            for (const hit of bars[p][pos[p]] ?? []) {
              // 拍の頭は少し強く
              const accent = pos[p] % 4 === 0 ? 1.1 : 1;
              strike(h, queue, view, p, tonic, hit.drum, stepAt + lilt(p, pos[p], s) + random(-0.004, 0.004), level * hit.v * accent * random(0.92, 1.05));
              hits[p][pos[p]] = Math.max(hits[p][pos[p]], hit.v);
            }
          });
          // クリックした高さの音を、空いている方の台で 3 つ連打する（だんだん弱く）
          for (const c of clicks) {
            const p = parts[SECOND].role === "solo" || parts[FIRST].role === "rest" ? FIRST : SECOND;
            play(h, queue, view, p, c.index, stepAt, level * (0.5 + 0.25 * c.left), 0.12);
            c.left--;
          }
          for (let k = clicks.length - 1; k >= 0; k--) if (clicks[k].left <= 0) clicks.splice(k, 1);
          shown.set(stepAt, { section, pos, hits: hits.map((x) => x.slice()) });

          stepAt += s;
          stepIn++;
          done++;
          if (stepIn < sections[section].steps) continue;
          stepIn = 0;
          section++;
          if (section < sections.length) continue;
          // 終わり: 次の小節の頭で、2 台がシンバルとキックを打ち、響きを残す
          ending = true;
          strike(h, queue, view, FIRST, 0, "crash", stepAt, 0.42);
          strike(h, queue, view, SECOND, 0, "crash", stepAt, 0.42);
          strike(h, queue, view, SECOND, 0, "kick", stepAt, 0.4);
          endAt = stepAt + 3;
        }
      });

      return {
        pointer(_x, y, height) {
          if (ending) return;
          clicks.push({ index: pitchIndexAt(y, height, ctx.pitches().length), left: 3 });
        },
        draw(g, width, height) {
          view.draw(g, width, height);
          legend(g, GUIDE_BOTTOM);
          drawKit(g, ctx, width, sections, shown.get());
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

// 上端: 台ごとに 1 小節の 16 分音符の箱を並べ（拍の頭は少し高く）、打った所を明るく、今の位置を一番明るくする。
// 横に役と拍子。2 台の拍子が違うと、箱の数が違い、頭がずれていくのが見える。下の行にタムの主音
function drawKit(g: CanvasRenderingContext2D, ctx: MovementContext, width: number, sections: Section[], now: { section: number; pos: number[]; hits: number[][] }) {
  const { parts, tonic } = sections[now.section];
  const left = guideLeft(g, GUIDE_BOTTOM);
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "left";
  // 箱の幅は、縦向きの電話でも役の名前が入るように、20 個の箱（5/4）が画面の半分ほどに収まる大きさまで縮める
  const cell = clamp((width - left) / 2 / 25, 5, 10);
  parts.forEach((part, p) => {
    const y = INFO_Y + p * 18;
    const len = lenOf(part);
    let x = left;
    for (let k = 0; k < len; k++) {
      const head = k % 4 === 0;
      const v = now.hits[p]?.[k] ?? 0;
      g.fillStyle = k === now.pos[p] && part.role !== "rest" ? "rgba(255, 255, 255, 0.9)" : ownerColor(p as 0 | 1, part.role === "rest" ? 0.1 : 0.14 + 0.6 * v);
      g.fillRect(x, y + (head ? 0 : 3), cell - 2, head ? 12 : 9);
      x += cell;
      if (k % 4 === 3) x += cell * 0.4;
    }
    let label = `${p === 0 ? "I" : "II"}: ${t(ROLE_NAMES[part.role][p])}`;
    if (part.role === "groove" && p === SECOND && (part.layers ?? 5) < 5) label += t({ ja: `（${part.layers} 本）`, en: ` (${part.layers})` });
    if (part.role !== "rest") label += ` · ${METERS[len]}`;
    g.fillStyle = ownerColor(p as 0 | 1, part.role === "rest" ? 0.3 : 0.85);
    g.fillText(label, x + 6, y + 10);
  });
  g.fillStyle = "rgba(255, 255, 255, 0.55)";
  const h = layout(ctx);
  g.fillText(t({ ja: `タムの主音: ${noteName(h, kitIndex(h, tonic, 7))}`, en: `Toms tuned to ${noteName(h, kitIndex(h, tonic, 7))}` }), left, INFO_Y + 48);
}

// --- I. 重ね ---

const layers = kitMovement({
  title: { ja: "I. 重ね", en: "I. Layers" },
  duration: 180,
  nominal: 180,
  pulse: 0.8,
  level: (progress) => 0.26 + 0.08 * Math.sin(Math.PI * clamp(progress, 0, 1)),
  plan: () => {
    const g = (layers: number): Part => ({ role: "groove", layers });
    const rest: Part = { role: "rest" };
    return [
      { parts: [rest, g(1)], bars: 2, tonic: 0 },
      { parts: [rest, g(2)], bars: 2, tonic: 0 },
      { parts: [rest, g(3)], bars: 4, tonic: 0 },
      { parts: [rest, g(4)], bars: 4, tonic: 0 },
      { parts: [{ role: "comp" }, g(5)], bars: 8, tonic: 0 },
      { parts: [{ role: "motif" }, g(5)], bars: 12, tonic: 0 },
      { parts: [{ role: "motif" }, g(4)], bars: 8, tonic: 3 },
      { parts: [{ role: "motif" }, g(5)], bars: 8, tonic: pick([4, 5]) },
      { parts: [{ role: "solo" }, g(3)], bars: 8, tonic: 0 },
      { parts: [{ role: "comp" }, { role: "solo" }], bars: 8, tonic: 3 },
      { parts: [{ role: "groove" }, g(5)], bars: 8, tonic: 0 },
      { parts: [rest, g(3)], bars: 2, tonic: 0 },
      { parts: [rest, g(2)], bars: 2, tonic: 0 },
      { parts: [rest, g(1)], bars: 2, tonic: 0 },
    ];
  },
});

// --- II. ワルツ ---

const waltz = kitMovement({
  title: { ja: "II. ワルツ", en: "II. Waltz" },
  duration: 150,
  nominal: 150,
  pulse: 0.6,
  level: (progress) => 0.22 + 0.08 * Math.sin(Math.PI * clamp(progress, 0, 1)),
  plan: () => [
    { parts: [{ role: "motif", len: 12 }, { role: "rest" }], bars: 6, tonic: 0 },
    { parts: [{ role: "motif", len: 12 }, { role: "groove", layers: 2 }], bars: 9, tonic: 0 },
    { parts: [{ role: "motif", len: 12 }, { role: "groove", layers: 3 }], bars: 9, tonic: 3 },
    { parts: [{ role: "groove", len: 12 }, { role: "motif" }], bars: 9, tonic: 4 },
    { parts: [{ role: "motif", len: 12 }, { role: "motif" }], bars: 6, tonic: 5 },
    { parts: [{ role: "groove", len: 12 }, { role: "groove", layers: 3, len: 12 }], bars: 6, tonic: 0 },
    { parts: [{ role: "motif", len: 12 }, { role: "rest", len: 12 }], bars: 3, tonic: 0 },
  ],
});

// --- III. 揃う ---

const converge = kitMovement({
  title: { ja: "III. 揃う", en: "III. Converge" },
  duration: 100,
  nominal: 100,
  pulse: 1,
  speed: (progress) => 1 + 0.15 * clamp(progress, 0, 1) ** 1.5,
  level: (progress) => 0.28 + 0.1 * clamp(progress, 0, 1),
  plan: () => {
    const solo: Part = { role: "solo" };
    const comp: Part = { role: "comp" };
    const sections: Section[] = [{ parts: [{ role: "groove" }, { role: "groove" }], bars: 4, tonic: 0 }];
    // ソロの交代: 4 小節ずつ 4 回、2 小節ずつ 4 回、1 小節ずつ 8 回。タムの主音も移る
    for (let k = 0; k < 4; k++) sections.push({ parts: k % 2 === 0 ? [solo, comp] : [comp, solo], bars: 4, tonic: k < 2 ? 0 : 3 });
    for (let k = 0; k < 4; k++) sections.push({ parts: k % 2 === 0 ? [solo, comp] : [comp, solo], bars: 2, tonic: k < 2 ? 4 : 0 });
    for (let k = 0; k < 8; k++) sections.push({ parts: k % 2 === 0 ? [solo, comp] : [comp, solo], bars: 1, tonic: [3, 4, 5, 0][k >> 1] });
    // ピアノ I が 5/4 で崩し、2 台で同じ打点を打って揃い、2 人のソロで終わる
    sections.push({ parts: [{ role: "solo", len: 20 }, { role: "groove" }], bars: 10, tonic: 0 });
    sections.push({ parts: [{ role: "kicks" }, { role: "kicks" }], bars: 4, tonic: 0 });
    sections.push({ parts: [solo, solo], bars: 2, tonic: 0 });
    return sections;
  },
});

export const twoDrummers: Sonata = {
  id: "drummers",
  composer: { ja: "二人のドラマー", en: "Two Drummers" },
  credit: { ja: "二人のドラマーが連弾したら", en: "as if two drummers played it" },
  initials: "Dr. & Dr.",
  scale: DORIAN,
  root: "D",
  modes: [DORIAN, AEOLIAN, MIXOLYDIAN, PHRYGIAN],
  movements: [layers, waltz, converge],
};
