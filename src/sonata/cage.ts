import * as Tone from "tone";
import { pitchIndexAt } from "../scales";
import { CHROMATIC, clamp, flowView, type HueMark, type Layout, layout, MARGIN_LEFT, MARGIN_RIGHT, type Movement, type MovementContext, note, pendingQueue, pick, rand, random, scheduler, type Sonata, TICK } from "./movement";

// ジョン・ケージがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// I.   平方根の形: 全体と部分が同じ比でできている。比（例えば 2:1:2:2）の数の和を S とすると、S 小節の単位が S 回並び、
//      単位の中の句も、単位をまとめた区切りも、同じ比で分かれる。前半と後半をそれぞれ繰り返す。
//      音は、決めておいた十数個の響き（音の手持ち）からだけ選ぶ
// II.  偶然の表: 音・長さ・強さの 8×8 の表から、易の卦（64 通り）を引くように偶然で選んで並べる。音の表の半分は沈黙。
//      動く升目は一度使うと新しい中身に替わり、動かない升目はそのまま残る。区切りごとに、速さと重なる声の数も偶然で決める
// III. 時間の枠: 音ごとに「この間に始め、この間に終える」という枠だけを決め、どこで始めてどこで終えるかは偶然にまかせる。
//      2 人の奏者が、それぞれの枠の並びを、静かに、長い沈黙を挟んで弾く
// 設定の「プリペアド・ピアノ」は、ケージでは初めから入れてある（ほかの作曲家では切ってある）
// ルバートは I だけに、気づくか気づかないかくらいに入れる。II と III は、演奏者の意図を入れないことが作り方なので揺らさない

// --- 画面: 鳴った音が右端から左へ流れる。上には、楽章ごとの仕組み（比・表・枠）を出す ---

const WINDOW = 14;
const CELL = 22; // 音の四角形の、左右それぞれの幅の上限（px）
const TALL = 1.5; // 音の四角形の高さの倍率（1 で帯の高さいっぱい）

const markView = (ctx: MovementContext) =>
  flowView<HueMark>(ctx, WINDOW, (g, m, x, y, ringing, fade, _span, _note, fit, band) => {
    // 四角形は、前後の音（同じ高さの帯）と少し隙間を残す幅まで広げる。縦は強い音ほど高く、いちばん強い音は帯の 1.5 倍
    const half = Math.max(fit(CELL, band * 0.9, 4), 1.5);
    const tall = TALL * (band - 4) * (0.3 + 0.7 * m.velocity);
    g.fillStyle = `hsla(${m.hue}, 50%, ${58 + 20 * ringing}%, ${(0.2 + 0.6 * ringing) * fade})`;
    g.fillRect(x - half, y - tall / 2, half * 2, tall);
  });

// 半音の数を、今の音階の段数に直す（半音階以外を選んだときも、音域の広がりがおおよそ保たれる）
const steps = (h: Layout, semitones: number) => Math.round((semitones * h.perOctave) / 12);

// --- I. 平方根の形 ---

// 比。数の和（S）が 6〜8 になるもの
const PROPORTIONS = [
  [2, 1, 2, 2],
  [3, 2, 2],
  [1, 2, 1, 3],
  [2, 3, 2],
  [1, 1, 2, 3],
  [2, 1, 1, 2, 2],
];

// 響き: 中心の音からの半音の数の組（1〜3 音）
type Sound = number[];

// 音の手持ち: 決まった響きを十数個だけ作り、楽章を通してそれだけを使う。プリペアド・ピアノでは鍵ごとに音色が決まっているので、
// 同じ響きは毎回同じ音色で戻ってくる。いちばん低い 2 つは、単位と句の頭で鳴らす銅鑼のような音
function newGamut(): Sound[] {
  const gamut: Sound[] = [];
  for (let i = 0; i < 12; i++) {
    const base = Math.floor(random(-10, 20));
    const size = rand() < 0.6 ? 1 : rand() < 0.75 ? 2 : 3;
    gamut.push(stack(size, () => pick([1, 2, 5, 6, 7, 10, 11])).map((o) => base + o));
  }
  return gamut;
}

type Hit = { slot: number; sound: number; accent: boolean };

// 句の型: 8 分音符の升目に、区切りの手持ちの響きを、休みを挟みながら置く。繰り返しの多い、ガムランのような型になる
function newMotif(slots: number, palette: number[], density: number): Hit[] {
  const hits: Hit[] = [];
  const chance = clamp(0.55 * density, 0.25, 0.85);
  for (let slot = 0; slot < slots; slot += pick([1, 1, 1, 2, 2, 3])) {
    if (slot === 0 || rand() < chance) hits.push({ slot, sound: pick(palette), accent: slot === 0 || rand() < 0.15 });
  }
  return hits;
}

// I のルバート: 句の初めは少し前へ進み、終わりへ向けてゆるめる。句の頭と長さは変えないので、比はそのまま保たれる。
// 句の中の位置 f（0〜1）を f − LEAN·f·(1 − f) に移す（速さは初め 1 − LEAN 倍、終わり 1 + LEAN 倍）
const LEAN = 0.04;

type PlanPhrase = { macro: number; micro: number; bars: number; unitStart: boolean };

const squareRoot: Movement = {
  title: { ja: "I. 平方根の形", en: "I. Square-root form" },
  duration: 220,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const beat = () => 60 / ctx.bpm();
    const ratio = pick(PROPORTIONS);
    const S = ratio.reduce((a, b) => a + b, 0);
    // 前半（A）と後半（B）の区切りの分け目: 和が S の半分を超えない所まで
    let half = 0;
    for (let sum = 0; half < ratio.length - 1 && sum + ratio[half] <= S / 2; half++) sum += ratio[half];
    half = Math.max(half, 1);
    // A A B B と弾くと、全部で 2 × S × S 小節。楽章の長さに収まるよう、1 小節の拍の数を決める
    const beatsPerBar = clamp(Math.round(squareRoot.duration / (2 * S * S * beat())), 1, 6);
    const plan: PlanPhrase[] = [];
    for (const [from, to] of [
      [0, half],
      [0, half],
      [half, ratio.length],
      [half, ratio.length],
    ])
      for (let macro = from; macro < to; macro++)
        for (let unit = 0; unit < ratio[macro]; unit++)
          ratio.forEach((bars, micro) => plan.push({ macro, micro, bars, unitStart: micro === 0 }));

    const gamut = newGamut();
    const order = gamut.map((_, i) => i).sort((a, b) => Math.min(...gamut[a]) - Math.min(...gamut[b]));
    const gongs = order.slice(0, 2);
    const upper = order.slice(2);
    // 区切りごとに、手持ちから 4〜5 個を選び、句ごとの型を作る（同じ区切りの単位は、同じ型を少しずつ崩して繰り返す）
    const motifs = ratio.map(() => {
      const palette = Array.from({ length: 4 + Math.floor(rand() * 2) }, () => pick(upper));
      return ratio.map((bars) => newMotif(bars * beatsPerBar * 2, palette, ctx.density()));
    });

    let k = 0;
    let phraseAt = startAt + 0.5;
    let ending = false;
    let shown: PlanPhrase | null = null;

    const play = (h: Layout, sound: number, at: number, velocity: number, seconds: number, hue: number) => {
      for (const offset of gamut[sound]) note(h, queue, view, h.centre + steps(h, offset), at, velocity, seconds, hue);
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending || phraseAt >= time + TICK) return;
      const h = layout(ctx, 12);
      const b = beat();
      if (k >= plan.length) {
        // 終わり: 銅鑼と、手持ちの最初の響きを長く置く
        ending = true;
        play(h, gongs[0], phraseAt, 0.4, 6, 200);
        play(h, upper[0], phraseAt + b, 0.25, 5, 30);
        endAt = phraseAt + 7;
        return;
      }
      const p = plan[k];
      const slot = b / 2;
      if (p.unitStart) play(h, gongs[0], phraseAt, 0.38, b * 6, 200);
      else play(h, gongs[1], phraseAt, 0.24, b * 3, 200);
      const slots = p.bars * beatsPerBar * 2;
      for (const hit of motifs[p.macro][p.micro]) {
        if (hit.slot > 0 && rand() < 0.08) continue; // 繰り返すたびに、ときどき抜ける
        const velocity = (hit.accent ? 0.42 : 0.27) * random(0.9, 1.1);
        const f = hit.slot / slots;
        play(h, hit.sound, phraseAt + (f - LEAN * f * (1 - f)) * slots * slot, velocity, slot * 2.5, 30);
      }
      Tone.getDraw().schedule(() => (shown = p), phraseAt);
      phraseAt += slots * slot;
      k++;
    });

    // 上に比を 2 段で出す: 上の段は区切り（単位のまとまり）、下の段は単位の中の句。今の所が明るくなる
    const drawRatio = (g: CanvasRenderingContext2D, width: number) => {
      const span = Math.min(width - MARGIN_LEFT - MARGIN_RIGHT, 360);
      g.font = "12px system-ui, sans-serif";
      g.textAlign = "left";
      g.fillStyle = "rgba(255, 255, 255, 0.45)";
      g.fillText(ratio.join(" : "), MARGIN_LEFT, 66);
      [0, 1].forEach((row) => {
        let x = MARGIN_LEFT;
        ratio.forEach((n, i) => {
          const w = (n / S) * span - 3;
          const current = shown && (row === 0 ? shown.macro === i : shown.micro === i);
          g.fillStyle = current ? "rgba(240, 200, 120, 0.75)" : "rgba(255, 255, 255, 0.12)";
          g.fillRect(x, 74 + row * 10, w, 6);
          x += w + 3;
        });
      });
    };

    return {
      pointer: (_x, y, height) => {
        if (ending) return;
        // クリック: その高さにいちばん近い手持ちの響きを鳴らす
        const h = layout(ctx, 12);
        const index = clamp(pitchIndexAt(y, height, h.count), 0, h.count - 1);
        const nearest = upper.reduce((best, s) => (Math.abs(h.centre + steps(h, gamut[s][0]) - index) < Math.abs(h.centre + steps(h, gamut[best][0]) - index) ? s : best), upper[0]);
        play(h, nearest, Tone.now() + 0.02, 0.32, 1.5, 50);
      },
      draw: (g, width, height) => {
        view.draw(g, width, height);
        drawRatio(g, width);
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

// --- II. 偶然の表 ---

type Kind = "rest" | "single" | "chord" | "cluster" | "figure";
type Cell = { kind: Kind; at: number; offsets: number[] }; // at: 鍵盤の中の高さ（0〜1）
const KIND_HUES: Record<Kind, number> = { rest: 0, single: 45, chord: 200, cluster: 330, figure: 120 };
const DURATIONS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 5 / 4, 3 / 2, 2, 5 / 2, 3, 4]; // 拍
const DYNAMICS = [0.05, 0.09, 0.14, 0.2, 0.28, 0.38, 0.5, 0.6]; // ppp〜fff
const TEMPI = [0.6, 0.75, 0.9, 1, 1, 1.15, 1.3, 1.5]; // テンポの倍率

// 下の音から、間隔を足しながら積む
function stack(size: number, interval: () => number): number[] {
  const offsets = [0];
  for (let k = 1; k < size; k++) offsets.push(offsets[k - 1] + interval());
  return offsets;
}

function newCell(silent: boolean): Cell {
  if (silent) return { kind: "rest", at: 0, offsets: [] };
  const kind = pick<Kind>(["single", "single", "chord", "cluster", "figure"]);
  const at = rand();
  const offsets =
    kind === "single"
      ? [0]
      : kind === "chord"
        ? stack(2 + Math.floor(rand() * 3), () => 5 + Math.floor(rand() * 10))
        : kind === "cluster"
          ? Array.from({ length: 3 + Math.floor(rand() * 3) }, (_, i) => i)
          : Array.from({ length: 3 + Math.floor(rand() * 4) }, () => Math.floor(random(-12, 13)));
  return { kind, at, offsets };
}

const chance: Movement = {
  title: { ja: "II. 偶然の表", en: "II. Charts of chance" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    // 3 つの表。音の表は、偶数の升目が沈黙。升目の半分は動く（使うと中身が替わる）
    const sounds = Array.from({ length: 64 }, (_, i) => newCell(i % 2 === 0));
    const lengths = Array.from({ length: 64 }, () => pick(DURATIONS));
    const dynamics = Array.from({ length: 64 }, () => pick(DYNAMICS));
    const mobile = Array.from({ length: 64 }, () => rand() < 0.5);
    let lastCast: { cell: number; time: number } | null = null;

    let sectionEnd = startAt + 0.5;
    let tempo = 1;
    let voices = 1;
    const nextAt = [startAt + 0.5, startAt + 0.5, startAt + 0.5];
    let ending = false;

    const play = (h: Layout, cell: Cell, at: number, velocity: number, seconds: number) => {
      const base = Math.floor(cell.at * (h.count + h.perOctave)) - Math.floor(h.perOctave / 2);
      cell.offsets.forEach((offset, i) => {
        // 速い音型は 1 音ずつ、ほかは同時に
        const time = cell.kind === "figure" ? at + i * 0.075 : at;
        note(h, queue, view, base + steps(h, offset), time, velocity, cell.kind === "figure" ? 0.4 : seconds, KIND_HUES[cell.kind]);
      });
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = layout(ctx, 12);
      const beat = 60 / (ctx.bpm() * tempo);
      // 区切り（8 拍）ごとに、速さと重なる声の数を偶然で決める
      if (sectionEnd < time + TICK) {
        if (sectionEnd - startAt >= chance.duration) {
          ending = true;
          endAt = Math.max(...nextAt, sectionEnd) + 4;
          return;
        }
        tempo = pick(TEMPI);
        voices = clamp(1 + Math.floor(rand() * 3 * Math.min(ctx.density(), 1.3)), 1, 3);
        sectionEnd += 8 * (60 / (ctx.bpm() * tempo));
      }
      nextAt.forEach((at, v) => {
        if (at >= time + TICK) return;
        if (v >= voices) {
          nextAt[v] = sectionEnd;
          return;
        }
        // 卦を 3 回引く: 音・長さ・強さ
        const s = Math.floor(rand() * 64);
        const d = Math.floor(rand() * 64);
        const f = Math.floor(rand() * 64);
        const cell = sounds[s];
        const length = lengths[d] * beat;
        if (cell.kind !== "rest") play(h, cell, at, dynamics[f], Math.max(length * 1.3, 0.3));
        Tone.getDraw().schedule(() => (lastCast = { cell: s, time: at }), at);
        if (mobile[s]) sounds[s] = newCell(s % 2 === 0);
        if (mobile[d]) lengths[d] = pick(DURATIONS);
        if (mobile[f]) dynamics[f] = pick(DYNAMICS);
        nextAt[v] = at + length;
      });
    });

    // 左上に音の表（8×8）を出す。沈黙の升目は枠だけ、動く升目は少し明るい。引いた升目が光り、その卦（6 本の線）を横に出す
    const drawChart = (g: CanvasRenderingContext2D) => {
      const size = 9;
      const top = 64;
      const now = Tone.now();
      sounds.forEach((cell, i) => {
        const x = MARGIN_LEFT + (i % 8) * (size + 2);
        const y = top + Math.floor(i / 8) * (size + 2);
        const lit = lastCast && lastCast.cell === i ? Math.max(0, 1 - (now - lastCast.time) / 1.5) : 0;
        if (cell.kind === "rest") {
          g.strokeStyle = `rgba(255, 255, 255, ${0.12 + 0.6 * lit})`;
          g.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
        } else {
          g.fillStyle = `hsla(${KIND_HUES[cell.kind]}, 50%, ${55 + 25 * lit}%, ${(mobile[i] ? 0.35 : 0.22) + 0.6 * lit})`;
          g.fillRect(x, y, size, size);
        }
      });
      if (!lastCast) return;
      const x = MARGIN_LEFT + 8 * (size + 2) + 14;
      g.fillStyle = "rgba(255, 255, 255, 0.45)";
      for (let line = 0; line < 6; line++) {
        const y = top + 80 - line * 13;
        // 下から 1 本ずつ。1 の位は実線、0 は真ん中の切れた線
        if ((lastCast.cell >> line) & 1) g.fillRect(x, y, 34, 5);
        else {
          g.fillRect(x, y, 14, 5);
          g.fillRect(x + 20, y, 14, 5);
        }
      }
    };

    return {
      pointer: (_x, y, height) => {
        if (ending) return;
        // クリック: その高さで、偶然の響きを 1 つ鳴らす
        const h = layout(ctx, 12);
        const cell = newCell(false);
        cell.at = clamp((pitchIndexAt(y, height, h.count) + h.perOctave / 2) / (h.count + h.perOctave), 0, 1);
        play(h, cell, Tone.now() + 0.02, 0.3, 1.5);
      },
      draw: (g, width, height) => {
        view.draw(g, width, height);
        drawChart(g);
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

// --- III. 時間の枠 ---

// 枠: 始めてよい間（startFrom〜startTo）と、終えてよい間（endFrom〜endTo）。どこで始めてどこで終えるか（start, end）は偶然で決める。
// 時刻は楽章の始まりからの秒
type Bracket = { part: number; startFrom: number; startTo: number; endFrom: number; endTo: number; start: number; end: number; offsets: number[]; base: number; played: boolean };

function newBrackets(duration: number, parts: number): Bracket[] {
  const scale = duration / 270;
  const brackets: Bracket[] = [];
  for (let part = 0; part < parts; part++) {
    let t = (random(2, 12) + part * random(8, 25)) * scale;
    while (t < duration - 25 * scale) {
      const window = random(8, 20) * scale;
      const span = random(22, 50) * scale;
      const startFrom = t;
      const startTo = t + window;
      const endFrom = t + span;
      const endTo = endFrom + window;
      const start = random(startFrom, startTo);
      const end = random(endFrom, endTo);
      const size = rand() < 0.55 ? 1 : rand() < 0.8 ? 2 : 3;
      const offsets = stack(size, () => pick([1, 2, 5, 6, 10, 11, 13]));
      brackets.push({ part, startFrom, startTo, endFrom, endTo, start, end, offsets, base: Math.floor(random(-12, 16)), played: false });
      // 次の枠: 前の枠の終わりの間のあたりから。ときどき長い沈黙を挟む
      t = endFrom + random(-5, rand() < 0.3 ? 35 : 15) * scale;
    }
  }
  return brackets;
}

const brackets: Movement = {
  title: { ja: "III. 時間の枠", en: "III. Time brackets" },
  duration: 270,
  start(ctx) {
    const startAt = Tone.now();
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const list = newBrackets(brackets.duration, ctx.density() > 1.2 ? 3 : 2);
    const last = Math.max(...list.map((b) => b.end));
    const endAt = startAt + 0.5 + last + 5;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      const h = layout(ctx, 12);
      for (const b of list) {
        const at = startAt + 0.5 + b.start;
        if (b.played || at >= time + TICK) continue;
        b.played = true;
        const until = startAt + 0.5 + b.end;
        // 音を 1 つずつ、少しずつずらして弾き、枠の終わりまで響かせる。長い枠では、途中でそっと弾き直す
        let strike = at;
        for (const offset of b.offsets) {
          const index = h.centre + steps(h, b.base + offset);
          note(h, queue, view, index, strike, random(0.12, 0.22), until - strike, 180 + 40 * b.part);
          if (until - strike > 14 && rand() < 0.4) {
            const again = strike + random(6, (until - strike) * 0.7);
            note(h, queue, view, index, again, 0.08, until - again, 180 + 40 * b.part);
          }
          strike += random(0.4, 3);
        }
      }
    });

    // 上に枠を奏者ごとに 1 段ずつ出す。細い括弧が始めてよい間と終えてよい間、そのあいだの線が実際に鳴らした間（鳴っている間は明るい）
    const drawBrackets = (g: CanvasRenderingContext2D, width: number) => {
      const span = width - MARGIN_LEFT - MARGIN_RIGHT;
      const total = Math.max(last, brackets.duration);
      const x = (s: number) => MARGIN_LEFT + (s / total) * span;
      const elapsed = Tone.now() - startAt - 0.5;
      for (const b of list) {
        const y = 66 + b.part * 14;
        const sounding = elapsed >= b.start && elapsed < b.end;
        g.strokeStyle = "rgba(255, 255, 255, 0.3)";
        g.lineWidth = 1;
        for (const [from, to] of [
          [b.startFrom, b.startTo],
          [b.endFrom, b.endTo],
        ]) {
          g.beginPath();
          g.moveTo(x(from), y - 4);
          g.lineTo(x(from), y);
          g.lineTo(x(to), y);
          g.lineTo(x(to), y - 4);
          g.stroke();
        }
        g.fillStyle = sounding ? `hsla(${180 + 40 * b.part}, 60%, 70%, 0.8)` : elapsed >= b.end ? "rgba(255, 255, 255, 0.15)" : "rgba(255, 255, 255, 0.07)";
        g.fillRect(x(b.start), y + 2, Math.max(x(b.end) - x(b.start), 1), 3);
      }
      g.fillStyle = "rgba(255, 255, 255, 0.5)";
      g.fillRect(x(clamp(elapsed, 0, total)), 56, 1, 14 * 3 + 6);
    };

    return {
      pointer: (_x, y, height) => {
        // クリック: その高さの音を、そっと長く響かせる
        const h = layout(ctx, 12);
        const index = clamp(pitchIndexAt(y, height, h.count), 0, h.count - 1);
        note(h, queue, view, index, Tone.now() + 0.02, 0.18, 6, 60);
      },
      draw: (g, width, height) => {
        view.draw(g, width, height);
        drawBrackets(g, width);
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

export const cage: Sonata = {
  id: "cage",
  composer: { ja: "ジョン・ケージ", en: "John Cage" },
  initials: "J.C.",
  // 半音階。音の手持ちや偶然で選ぶ音は、調や和音にとらわれない
  scale: CHROMATIC,
  root: "C", // 主音。半音階なので、調号のない C
  movements: [squareRoot, chance, brackets],
  prepared: true,
};
