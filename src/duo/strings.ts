import * as Tone from "tone";
import { t, type L } from "../i18n";
import { pitchIndexAt, SCALES } from "../scales";
import {
  clamp,
  type Layout,
  layout,
  type Movement,
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
import { FIRST, INFO_Y, legend, markView, ownerColor, play, SECOND, type View, guideLeft } from "./common";

// 上端の案内の下端（音部記号・調号と重なるかを見るため）
const GUIDE_BOTTOM = INFO_Y + 38;

// 二人の弦楽器奏者が、2 台のピアノで連弾したら、という試み。北インドの 2 つの弦楽器が 1 つのラーガを共に弾く
// ジュガルバンディの形を、ピアノに移している。楽章は、ラーガの演奏の 3 つの段（アーラープ・ジョール・ジャーラー）に当てる。
// I.   アーラープ: 拍のない導入。片方が低いところで持続音（タンプーラの型）を回し、2 人が句を交互に弾く。
//      答える方は、前の句の終わりを真似てから先へ進む。句の届く高さが、主音の近くから少しずつ上へ開いていく
// II.  ジョール: 拍が出る。弾き手は 1 拍に 2 つ → 3 つ → 4 つと細かくなる音型（3 つずつずらして上る、など）で進み、
//      もう一方は主音と高い主音の刻み（チカーリー）で拍を支える。弾き手の交代は 16 拍 → 8 → 4 と短くなる
// III. ジャーラー: 速い拍の中で、旋律の音 1 つと高い主音の刻み 3 つを繰り返す。問い（ピアノ I）と答え（ピアノ II）が
//      8 拍 → 4 → 2 → 1 と短くなり、2 人がそろって弾いたあと、同じ句を 3 度繰り返して頭の拍に着く終わり方（ティハーイー）で止まる
//
// 音階はラーガ。初めはヤマン（夕方のラーガ）で、主音は C。ラーガごとに、中心の音（ヴァーディー）、決まり文句（パカド）、
// 上るときに飛ばす音、揺らす音（アーンドーラン）を持つ。設定で、バイラヴ・バイラヴィ・トーディにも変えられる

const RAGA_IDS = ["yaman", "bhairav", "bhairavi", "todi"];
const RAGAS = RAGA_IDS.map((id) => SCALES.find((s) => s.id === id)!);

type Traits = { vadi: number; pakad: number[][]; skipUp: number[]; andolan: number[] };
// 度数は、真ん中の主音（サ）から数える（7 で 1 オクターブ上、負は下）
const TRAITS: Record<string, Traits> = {
  // N R G R S、P M G R S。上るときはサとパを飛ばす（N R G M D N S）
  yaman: { vadi: 2, pakad: [[-1, 1, 2, 1, 0], [4, 3, 2, 1, 0], [-1, 1, 2, 3, 5, 6, 7]], skipUp: [0, 4], andolan: [] },
  // G M d d P、G M r r S。r と d を揺らす
  bhairav: { vadi: 5, pakad: [[2, 3, 5, 5, 4], [2, 3, 1, 1, 0]], skipUp: [], andolan: [1, 5] },
  // g m d P g m g r S
  bhairavi: { vadi: 3, pakad: [[2, 3, 5, 4, 2, 3, 2, 1, 0], [3, 2, 1, 0]], skipUp: [], andolan: [] },
  // d N S r g r S、g M d M g r S。パはあまり使わない。r g d を揺らす
  todi: { vadi: 5, pakad: [[-2, -1, 0, 1, 2, 1, 0], [2, 3, 5, 3, 2, 1, 0]], skipUp: [4], andolan: [1, 2, 5] },
};
const mode = () => twoStringPlayers.scale;
const traits = () => TRAITS[mode().id] ?? TRAITS.yaman;
const mod7 = (d: number) => ((d % 7) + 7) % 7;
const semi = (d: number) => mode().steps[mod7(d)] + 12 * Math.floor(d / 7);

// 度数の音の位置（真ん中の主音から）
const at = (h: Layout, d: number) => h.centre + h.degree(d);

// サルガム（インドの階名）。r g d n は低い音（コーマル）、M は高いマ（ティーヴラ）。上のオクターブは上に点、下は下に点
const SARGAM = ["S", "r", "R", "g", "G", "m", "M", "P", "d", "D", "n", "N"];
function sargam(d: number): string {
  const name = SARGAM[((Math.round(semi(d)) % 12) + 12) % 12];
  const octave = Math.floor(d / 7);
  return octave > 0 ? `${name}̇` : octave < 0 ? `${name}̣` : name;
}

// from から to へ、1 段ずつ。上るときは、そのラーガで飛ばす音を飛ばす（行き先は飛ばさない）
function walk(from: number, to: number): number[] {
  const notes: number[] = [];
  const dir = Math.sign(to - from);
  for (let d = from + dir; dir !== 0 && d !== to + dir; d += dir) {
    if (dir > 0 && d !== to && traits().skipUp.includes(mod7(d))) continue;
    notes.push(d);
  }
  return notes;
}

// 鳴った音の階名を、上端に流して見せる
type Trail = { time: number; name: string; piano: number }[];
function note(h: Layout, queue: Queue, view: View, trail: Trail, piano: number, d: number, time: number, velocity: number, seconds: number, cents = 0) {
  play(h, queue, view, piano, at(h, d), time, velocity, seconds, cents);
  trail.push({ time, name: sargam(d), piano });
  if (trail.length > 40) trail.splice(0, trail.length - 40);
}

function drawTrail(g: CanvasRenderingContext2D, trail: Trail, y: number) {
  const now = Tone.now();
  const shown = trail.filter((e) => e.time <= now).slice(-14);
  g.font = "14px system-ui, sans-serif";
  g.textAlign = "left";
  let x = guideLeft(g, GUIDE_BOTTOM);
  shown.forEach((e, k) => {
    g.fillStyle = ownerColor(e.piano as 0 | 1, 0.25 + (0.7 * (k + 1)) / shown.length);
    g.fillText(e.name, x, y);
    x += g.measureText(e.name).width + 8;
  });
}

function drawInfo(g: CanvasRenderingContext2D, text: string) {
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "left";
  g.fillStyle = "rgba(255, 255, 255, 0.55)";
  g.fillText(text, guideLeft(g, GUIDE_BOTTOM), INFO_Y + 10);
}

// タンプーラの型（低いパ・サ・サ・低いサ）を、柔らかく 1 周鳴らす。長さ（秒）を返す
function tanpura(h: Layout, queue: Queue, view: View, piano: number, time: number, level: number): number {
  const gap = 1.1;
  const pa = mode().id === "todi" ? -7 : -3; // パをあまり使わないトーディでは、低いサを 2 度
  [pa, 0, 0, -7].forEach((d, k) => play(h, queue, view, piano, at(h, d) - h.perOctave, time + k * gap, level * (k === 3 ? 1.2 : 1), 3.5));
  return gap * 4;
}

// 長い音の飾り: 前に上の隣の音を短く付ける（カン）。揺らす音では、少し低くずらした音を何度か重ねる（アーンドーラン）
function ornamented(h: Layout, queue: Queue, view: View, trail: Trail, piano: number, d: number, time: number, velocity: number, seconds: number) {
  if (rand() < 0.45) play(h, queue, view, piano, at(h, d + 1), time - 0.07, velocity * 0.5, 0.1);
  note(h, queue, view, trail, piano, d, time, velocity, seconds);
  if (traits().andolan.includes(mod7(d)) && seconds > 1) {
    for (let k = 1; k * 0.4 < seconds - 0.3; k++) play(h, queue, view, piano, at(h, d), time + k * 0.4, velocity * 0.35, 0.5, k % 2 === 1 ? -30 : 0);
  }
}

// --- I. アーラープ ---

// 句: 始まりの音から、そのときの上限まで上がり（ときどき決まり文句を挟み）、主音か中心の音に降りて休む
function alapPhrase(start: number, top: number, low: number): { d: number; seconds: number }[] {
  const tr = traits();
  const peak = clamp(top - Math.floor(rand() * 3), low + 2, top);
  const rest = pick([0, 0, tr.vadi, tr.vadi - 7, 4].filter((d) => d <= peak && d >= low));
  let line = [start];
  // 決まり文句が音域の中に収まれば、句の頭に置く
  const fitting = tr.pakad.filter((p) => p.every((d) => d >= low && d <= top));
  if (fitting.length && rand() < 0.5) line = [...pick(fitting)];
  line.push(...walk(line.at(-1)!, peak), ...walk(peak, rest));
  return line.map((d, k) => {
    const last = k === line.length - 1;
    const atPeak = d === peak && k > 0;
    return { d, seconds: last ? random(2.2, 3.2) : atPeak ? random(1.4, 2.2) : rand() < 0.25 ? random(0.9, 1.3) : random(0.35, 0.6) };
  });
}

const alap: Movement = {
  title: { ja: "I. アーラープ", en: "I. Ālāp" },
  duration: 200,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const trail: Trail = [];
    let phraseAt = startAt + 2.5;
    let droneAt = startAt + 0.3;
    let leader: number = FIRST;
    let last: number[] = [0];
    let ending = false;
    const shownTop = timed(2);
    // 速さの設定で、句の音の長さが変わる（132 で 1 倍）
    const stretch = () => 132 / ctx.bpm();

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      const h = layout(ctx);
      const progress = (time - startAt) / alap.duration;
      // 持続音: ピアノ II が低いところで回し続ける（終わりの句が鳴り終わるまで）
      while (droneAt < Math.min(time + TICK, endAt - 2)) droneAt += tanpura(h, queue, view, SECOND, droneAt, 0.12);
      while (!ending && phraseAt < time + TICK) {
        // 届く高さ: 主音の近く（ガ）から始め、終わりの手前でふた回り上のガまで開く
        const top = Math.round(2 + 10 * clamp(progress / 0.85, 0, 1) ** 1.2);
        const low = progress < 0.3 ? -3 : -5;
        shownTop.set(phraseAt, top);
        if (progress >= 0.9) {
          // 終わり: 2 人が上の主音から降りて、主音に着く
          ending = true;
          const down = [7, ...walk(7, 0)];
          let t0 = phraseAt;
          down.forEach((d, k) => {
            const seconds = (k === down.length - 1 ? 4 : 0.8) * stretch();
            note(h, queue, view, trail, FIRST, d, t0, 0.24, seconds);
            play(h, queue, view, SECOND, at(h, d) - h.perOctave, t0 + 0.03, 0.2, seconds);
            t0 += k === down.length - 1 ? 0 : 0.8 * stretch();
          });
          endAt = t0 + 5;
          break;
        }
        // 答える方は、前の句の終わりの 3 つを真似てから進む
        const echo = last.slice(-3);
        const phrase = [...echo.map((d) => ({ d, seconds: random(0.4, 0.7) })), ...alapPhrase(echo.at(-1) ?? 0, top, low)];
        let t0 = phraseAt;
        const level = 0.2 + 0.1 * Math.sin(Math.PI * clamp(progress, 0, 1));
        phrase.forEach(({ d, seconds }, k) => {
          const length = seconds * stretch();
          if (length > 0.8) ornamented(h, queue, view, trail, leader, d, t0, level * (k === 0 ? 0.9 : 1), length * 1.3);
          else note(h, queue, view, trail, leader, d, t0, level * 0.85, length * 1.5);
          t0 += length;
        });
        last = phrase.map((p) => p.d);
        leader = leader === FIRST ? SECOND : FIRST;
        phraseAt = t0 + random(0.8, 1.6) * stretch();
      }
    });

    return {
      // クリックした高さの音を、今の弾き手が飾りを付けて鳴らす
      pointer(_x, y, height) {
        if (ending) return;
        const h = layout(ctx);
        play(h, queue, view, leader, pitchIndexAt(y, height, h.count), Tone.now() + 0.02, 0.22, 1.8);
      },
      draw(g, width, height) {
        view.draw(g, width, height);
        legend(g, GUIDE_BOTTOM);
        drawInfo(g, `${t({ ja: "拍のない導入。届く高さ", en: "Unmetred opening. Reaching up to" })} ${sargam(shownTop.get())}`);
        drawTrail(g, trail, INFO_Y + 34);
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

// --- II. ジョール ---

// 音型: size 音ずつの組を、1 段ずつずらして上り、また下りる（3 つなら S R G、R G M、G M P …）。最後は主音に戻る
function palta(size: number, low: number, top: number): number[] {
  const scale = [low, ...walk(low, top)];
  const cells: number[] = [];
  for (let k = 0; k + size <= scale.length; k++) cells.push(...scale.slice(k, k + size));
  for (let k = scale.length - 1; k - size + 1 >= 0; k--) cells.push(...scale.slice(k - size + 1, k + 1).reverse());
  return cells;
}

const jor: Movement = {
  title: { ja: "II. ジョール", en: "II. Jor" },
  duration: 170,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const trail: Trail = [];
    let beatAt = startAt + 0.4;
    let beat = 0;
    let leader: number = FIRST;
    let turnLeft = 16;
    let line: number[] = [];
    let ending = false;
    const shown = timed({ split: 2, turn: 16 });
    const beatSeconds = () => 60 / (ctx.bpm() * 0.62);

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      while (!ending && beatAt < time + TICK) {
        const h = layout(ctx);
        const progress = (beatAt - startAt) / jor.duration;
        const b = beatSeconds() / (1 + 0.15 * clamp(progress, 0, 1)); // 少しずつ速くなる
        const split = progress < 0.35 ? 2 : progress < 0.7 ? 3 : 4;
        const turn = progress < 0.35 ? 16 : progress < 0.7 ? 8 : 4;
        const level = 0.2 + 0.12 * clamp(progress, 0, 1);
        const accompanist = leader === FIRST ? SECOND : FIRST;
        shown.set(beatAt, { split, turn });
        if (progress >= 1) {
          // 終わり: 弾き手が主音を長く伸ばし、もう一方が低い主音と高い主音を重ねる
          ending = true;
          ornamented(h, queue, view, trail, leader, 0, beatAt, 0.28, 4);
          play(h, queue, view, accompanist, at(h, -7), beatAt, 0.26, 4.5);
          play(h, queue, view, accompanist, at(h, 7), beatAt, 0.16, 3);
          endAt = beatAt + 5;
          break;
        }
        // 支え: 4 拍の頭に低い主音、ほかの拍の裏に高い主音を 2 つ（チカーリー）
        if (beat % 4 === 0) play(h, queue, view, accompanist, at(h, -7), beatAt, level * 1.1, b * 2);
        play(h, queue, view, accompanist, at(h, 7), beatAt + b / 2, level * 0.5, b * 0.4);
        play(h, queue, view, accompanist, at(h, 7), beatAt + (b * 3) / 4, level * 0.4, b * 0.3);
        // 弾き手: 音型を 1 拍に split 個ずつ。音型が尽きたら次を作る（届く高さは少しずつ上がる）
        for (let k = 0; k < split; k++) {
          if (line.length === 0) {
            const top = Math.round(4 + 6 * clamp(progress, 0, 1));
            line = rand() < 0.3 ? [...pick(traits().pakad), 0] : palta(split, pick([-3, -1, 0]), top);
          }
          const d = line.shift()!;
          const accent = k === 0 ? 1.2 : 1;
          note(h, queue, view, trail, leader, d, beatAt + (k * b) / split, level * accent * random(0.92, 1.05), (b / split) * 1.6);
        }
        beatAt += b;
        beat++;
        if (--turnLeft > 0) continue;
        leader = accompanist;
        turnLeft = turn;
        line = [];
      }
    });

    return {
      // クリックした高さの音を、支えている方が拍の裏で鳴らす
      pointer(_x, y, height) {
        if (ending) return;
        const h = layout(ctx);
        play(h, queue, view, leader === FIRST ? SECOND : FIRST, pitchIndexAt(y, height, h.count), Tone.now() + 0.02, 0.24, 0.6);
      },
      draw(g, width, height) {
        view.draw(g, width, height);
        legend(g, GUIDE_BOTTOM);
        const now = shown.get();
        drawInfo(g, t({ ja: `拍が出る。1 拍に ${now.split} つ、${now.turn} 拍ごとに交代`, en: `A pulse appears. ${now.split} notes a beat, turns of ${now.turn} beats` }));
        drawTrail(g, trail, INFO_Y + 34);
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

// --- III. ジャーラー ---

type Exchange = { who: number | "both" | "tihai"; beats: number };
const QUESTIONS = [
  [8, 2],
  [4, 2],
  [2, 3],
  [1, 4],
]; // 問いと答えの長さ（拍）と、その組の数

const jhala: Movement = {
  title: { ja: "III. ジャーラー", en: "III. Jhālā" },
  duration: 140,
  start(ctx) {
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const trail: Trail = [];
    const scale = jhala.duration / 140;

    // 問いと答えの順。?short のときは組の数を減らす
    const plan: Exchange[] = [{ who: "both", beats: 8 }];
    for (const [beats, count] of QUESTIONS) {
      for (let k = 0; k < Math.max(1, Math.round(count * scale)); k++) plan.push({ who: FIRST, beats }, { who: SECOND, beats });
    }
    plan.push({ who: "both", beats: Math.max(8, Math.round(16 * scale)) }, { who: "tihai", beats: 16 });
    const totalBeats = plan.reduce((a, e) => a + e.beats, 0);

    let part = 0;
    let within = 0;
    let done = 0;
    let beatAt = Tone.now() + 0.4;
    let question: number[] = []; // 問いの旋律（答えは、これをなぞってから違う所に着く）
    let melody: number[] = [];
    let ending = false;
    const shown = timed(0);
    const beatSeconds = () => 60 / (ctx.bpm() * 1.0);

    // 旋律: 1 拍に 1 音。届く高さの中で、1 段ずつ上り下りし、ときどき決まり文句をなぞる
    const makeMelody = (beats: number, from: number, top: number) => {
      const notes: number[] = [];
      let d = from;
      let dir = 1;
      while (notes.length < beats) {
        if (rand() < 0.2) {
          notes.push(...pick(traits().pakad));
          continue;
        }
        notes.push(d);
        const next = walk(d, d + dir)[0] ?? d + dir;
        d = next;
        if (d >= top) dir = -1;
        if (d <= -3) dir = 1;
        if (rand() < 0.15) dir = -dir;
      }
      return notes.slice(0, beats);
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      while (!ending && beatAt < time + TICK) {
        const h = layout(ctx);
        const progress = done / totalBeats;
        const b = beatSeconds() / (1 + 0.35 * progress ** 1.3); // だんだん速くなる
        const current = plan[part];
        const level = 0.22 + 0.14 * progress;
        if (within === 0) {
          shown.set(beatAt, part);
          const top = Math.round(5 + 5 * progress);
          if (current.who === FIRST) question = melody = makeMelody(current.beats, pick([0, 2, 4]), top);
          else if (current.who === SECOND) {
            // 答え: 問いの前半をなぞり、後半は違う道で主音か中心の音に着く
            const half = Math.ceil(question.length / 2);
            melody = [...question.slice(0, half), ...makeMelody(current.beats - half, question[half - 1] ?? 0, top)];
            melody[melody.length - 1] = pick([0, traits().vadi]);
          } else if (current.who === "both") melody = makeMelody(current.beats, 0, top);
          else {
            // ティハーイー: 5 拍の句と 1 拍の休みを 3 度。3 度目の句の最後の音（主音）は、終わりの和音として次の頭の拍（サム）に鳴る
            const phrase = mode().id === "todi" ? [5, 3, 2, 1, 0] : [4, 3, 2, 1, 0];
            melody = [...phrase, NaN, ...phrase, NaN, ...phrase.slice(0, -1)];
          }
        }
        const d = melody[within];
        const players = current.who === "both" || current.who === "tihai" ? [FIRST, SECOND] : [current.who];
        for (const p of players) {
          const octave = p === SECOND && players.length === 2 ? -7 : 0;
          // 1 拍を 4 つに: 旋律の音 1 つと、高い主音の刻み 3 つ（ティハーイーでは旋律の音を強く、休みの拍は刻みだけ）
          if (!Number.isNaN(d)) note(h, queue, view, trail, p, d + octave, beatAt, level * (current.who === "tihai" ? 1.4 : 1.1), b * 0.9);
          for (let k = 1; k < 4; k++) play(h, queue, view, p, at(h, 7 + octave), beatAt + (k * b) / 4, level * 0.42 * random(0.9, 1.05), b * 0.2);
        }
        // 問いと答えのあいだ、休んでいる方は 4 拍ごとに低い主音
        if (players.length === 1 && within % 4 === 0) play(h, queue, view, players[0] === FIRST ? SECOND : FIRST, at(h, -7), beatAt, level * 0.9, b * 3);
        beatAt += b;
        within++;
        done++;
        if (within < current.beats) continue;
        within = 0;
        part++;
        if (part < plan.length) continue;
        // 終わり: ティハーイーの着いた頭の拍で、2 台が主音を重ねる
        ending = true;
        for (const [p, d] of [[FIRST, 7], [FIRST, 0], [SECOND, -7], [SECOND, -3]] as const) play(h, queue, view, p, at(h, d), beatAt, 0.42, 4);
        play(h, queue, view, SECOND, at(h, -14), beatAt, 0.36, 5);
        endAt = beatAt + 5;
      }
    });

    return {
      // クリックした高さの音を、次の拍の頭で、休んでいる方（そろって弾くときはピアノ II）が鳴らす
      pointer(_x, y, height) {
        if (ending) return;
        const h = layout(ctx);
        const who = plan[part]?.who;
        play(h, queue, view, who === SECOND ? FIRST : SECOND, pitchIndexAt(y, height, h.count), Tone.now() + 0.02, 0.26, 0.4);
      },
      draw(g, width, height) {
        view.draw(g, width, height);
        legend(g, GUIDE_BOTTOM);
        const now = plan[shown.get()];
        const text: L =
          now.who === "tihai"
            ? { ja: "ティハーイー（同じ句を 3 度、頭の拍に着く）", en: "Tihāī (one phrase three times, landing on the downbeat)" }
            : now.who === "both"
              ? { ja: "2 人でそろって", en: "Both together" }
              : now.who === FIRST
                ? { ja: `問い ${now.beats} 拍（ピアノ I）`, en: `Question, ${now.beats} beats (piano I)` }
                : { ja: `答え ${now.beats} 拍（ピアノ II）`, en: `Answer, ${now.beats} beats (piano II)` };
        drawInfo(g, t(text));
        drawTrail(g, trail, INFO_Y + 34);
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

export const twoStringPlayers: Sonata = {
  id: "strings",
  composer: { ja: "二人の弦楽器奏者", en: "Two String Players" },
  credit: { ja: "二人の弦楽器奏者が連弾したら", en: "as if two string players played it" },
  initials: "St. & St.",
  scale: RAGAS[0],
  root: "C",
  modes: RAGAS,
  tuning: "loose",
  movements: [alap, jor, jhala],
};
