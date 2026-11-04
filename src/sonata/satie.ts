import * as Tone from "tone";
import { type L, t } from "../i18n";
import { pitchIndexAt } from "../scales";
import { DORIAN, flowView, type HueMark, type Layout, layout, type Movement, type MovementContext, musicFrom, note, pendingQueue, type Queue, rand, random, scheduler, type Sonata, staffPen, TICK } from "./movement";
import { staffTop } from "./staff";

// エリック・サティがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// I.   ゆるやかな舞曲: 3 拍子。左手は 1 拍目に低い音、2 拍目に和音。2 つの和音を揺り返す上に、素朴な旋律が浮かび、同じ節がそのまま戻ってくる
// II.  小節線のない歌: 左手は同じ低音と和音を刻み続け、右手は飾りの付いた短い節を、決まりのない長さで繰り返す。ときどき両手とも立ち止まる
// III. 家具の音楽: 聞き流されるための短いループを何度も繰り返し、前触れなく別のループへ移る。最後は最初のループに戻り、ふいに終わる
// サティは楽譜に風変わりな言葉を書き込んだ。ここでも区切りごとに、演奏の心得のような言葉（このページのために書いたもの）を画面に出す

// --- 画面: 鳴った音が右端から左へ流れる。左上には、区切りごとの心得の言葉を出す ---

const WINDOW = 16;
const TURN_LEAD = 0.27; // 回り込む飾りが、本当の音より先に始まる長さ（秒）

// 演奏の心得（サティの書き込みの真似ではなく、このページのために書いた言葉）
const DIRECTIONS: L[] = [
  { ja: "ゆっくりと、窓の外を眺めながら", en: "Slowly, looking out of the window" },
  { ja: "少し得意げに", en: "A little proudly" },
  { ja: "帽子を手に持って", en: "Hat in hand" },
  { ja: "考えすぎないで", en: "Without thinking too much" },
  { ja: "白く、遠くで", en: "White, and far away" },
  { ja: "そっと、自分にも聞こえないくらいに", en: "Softly, barely audible even to yourself" },
  { ja: "雨傘をたたむように", en: "Like folding an umbrella" },
  { ja: "ほんの少しだけ驚いて", en: "Only slightly surprised" },
  { ja: "眠たげな猫のように", en: "Like a drowsy cat" },
  { ja: "朝のパンを待ちながら", en: "While waiting for the morning bread" },
  { ja: "うしろを振り返らずに", en: "Without looking back" },
  { ja: "ていねいに、でも気取らずに", en: "Carefully, but without airs" },
  { ja: "誰かの噂話のように", en: "Like a bit of gossip" },
  { ja: "まっすぐに、でも急がずに", en: "Straight on, but in no hurry" },
  { ja: "少し古びた礼儀正しさで", en: "With slightly old-fashioned manners" },
  { ja: "何も言わないで", en: "Without saying anything" },
];

function markView(ctx: MovementContext) {
  const flow = flowView<HueMark>(ctx, WINDOW, (g, m, x, y, ringing, fade, _span, note) => {
    g.fillStyle = `hsla(${m.hue}, 45%, ${60 + 20 * ringing}%, ${(0.2 + 0.6 * ringing) * fade})`;
    note(2 * (2 + 6 * m.velocity + 3 * ringing));
  });
  let direction: { text: L; time: number } | null = null;
  return {
    add: flow.add,
    // 区切りの頭で、心得の言葉を 1 つ出す（音と同じ時刻に変わる）
    say: (time: number) => {
      const text = DIRECTIONS[Math.floor(rand() * DIRECTIONS.length)];
      Tone.getDraw().schedule(() => (direction = { text, time }), time);
    },
    clear: () => {
      flow.clear();
      direction = null;
    },
    draw(g: CanvasRenderingContext2D, width: number, height: number) {
      flow.draw(g, width, height);
      if (direction) {
        const age = Tone.now() - direction.time;
        const alpha = Math.max(0, Math.min(1, age / 1.5, (20 - age) / 4));
        g.font = "italic 15px Georgia, 'Times New Roman', serif";
        g.textAlign = "left";
        g.fillStyle = `rgba(255, 255, 255, ${0.6 * alpha})`;
        // 楽譜の発想記号のように、調号の右で、ト音記号の五線より上に置く。高さの低い画面（スマホの横向き）では五線が上に寄るので、そのすぐ上に
        const top = staffTop() - staffPen(ctx, height).top;
        g.fillText(t(direction.text), musicFrom(), Math.min(92, top - 10));
      }
    },
  };
}

type View = ReturnType<typeof markView>;

const MELODY = 205;
const LEFT = 30;

// 左手の低い音と和音。根音は主音から数えた度数。低い音は画面の一番下の主音より 1 オクターブ下から、
// 和音はその 1 オクターブ上で、根音の上に 3 度ずつ重ねる（7 の音を含む柔らかい和音）
function bass(h: Layout, queue: Queue, view: View, root: number, time: number, velocity: number, seconds: number) {
  note(h, queue, view, h.lowRoot + h.degree(root % 7) - h.perOctave, time, velocity, seconds, LEFT);
}
function chord(h: Layout, queue: Queue, view: View, root: number, time: number, velocity: number, seconds: number) {
  const base = h.lowRoot + h.degree(root % 7);
  for (const d of [2, 4, 6]) note(h, queue, view, base + h.degree(d), time, velocity * random(0.9, 1.05), seconds, LEFT);
}

// クリック: その高さの音に、3 度下の音を添えて、そっと鳴らす
function softAt(ctx: MovementContext, queue: Queue, view: View, y: number, height: number) {
  const h = layout(ctx);
  const index = Math.min(Math.max(pitchIndexAt(y, height, h.count), 0), h.count - 1);
  const time = Tone.now() + 0.02;
  note(h, queue, view, index, time, 0.3, 2.5, 45);
  note(h, queue, view, index - h.degree(2), time + 0.03, 0.2, 2.5, 45);
}

// --- I. ゆるやかな舞曲 ---

// 区切りごとの和音の根音（度数）。1 小節に 1 つ。A は 2 つの和音を揺り返し、B は少し遠くへ出かける
const INTRO = [3, 0, 3, 0];
const SECTION_A = [3, 0, 3, 0, 3, 0, 3, 0, 1, 4, 1, 4, 5, 2, 3, 0];
const SECTION_B = [2, 5, 2, 5, 1, 4, 1, 4, 6, 3, 6, 3, 4, 4, 0, 0];
const OUTRO = [3, 0, 3, 0];

// 旋律の 1 小節のリズム（拍の位置と長さ）。3 拍子
const BAR_RHYTHMS: [number, number][][] = [[[0, 3]], [[1, 2]], [[0, 1], [1, 2]], [[0, 2], [2, 1]], [[1, 1], [2, 1]], []];

type Phrase = { bars: { at: number; beats: number; step: number }[][] };

// 旋律の 1 節（4 小節）。上から始まり、隣の音へ動きながら少しずつ降りてくる。最後の小節は長い音で休む
function newPhrase(): Phrase {
  const bars = Array.from({ length: 4 }, (_, i) => {
    const rhythm = i === 3 ? [[0, 3] as [number, number]] : BAR_RHYTHMS[Math.floor(rand() * (i === 0 ? 2 : BAR_RHYTHMS.length))];
    return rhythm.map(([at, beats]) => ({ at, beats, step: rand() < 0.65 ? -1 : rand() < 0.6 ? 1 : -2 }));
  });
  return { bars };
}

const dance: Movement = {
  title: { ja: "I. ゆるやかな舞曲", en: "I. Slow dance" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const beat = () => 140 / ctx.bpm(); // テンポ 132 のとき約 1 秒
    // 旋律は区切りの種類ごとに作り、同じ区切りが戻ってくると同じ節をそのまま弾く
    const phrases = { A: [newPhrase(), newPhrase(), newPhrase(), newPhrase()], B: [newPhrase(), newPhrase(), newPhrase(), newPhrase()] };
    const plan: { chords: number[]; melody: Phrase[] | null }[] = [{ chords: INTRO, melody: null }];
    const order: ("A" | "B")[] = ["A", "A", "B", "A", "B", "A"];
    let section = 0; // plan の何番目か
    let bar = 0; // 区切りの中の小節
    let next = 0; // order の次
    let barAt = startAt + 0.5;
    let degree = 9; // 旋律の今の音（中心の主音から数えた度数）
    let ending = false;
    view.say(barAt);

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending || barAt >= time + TICK) return;
      const h = layout(ctx);
      const b = beat();
      const progress = (barAt - startAt) / dance.duration;
      if (bar >= plan[section].chords.length) {
        // 次の区切りへ。残りの時間に収まらなければ、終わりの区切りにする
        section++;
        bar = 0;
        const kind = order[next % order.length];
        const remaining = dance.duration - (barAt - startAt);
        if (plan[section - 1].chords === OUTRO) {
          // 終わり: 最後の和音を長く置く
          ending = true;
          bass(h, queue, view, 0, barAt, 0.28, b * 8);
          chord(h, queue, view, 0, barAt + b, 0.2, b * 7);
          note(h, queue, view, h.centre + h.degree(4), barAt + b * 2, 0.24, b * 6, MELODY);
          endAt = barAt + b * 8;
          return;
        }
        if (remaining < (SECTION_A.length + OUTRO.length) * 3 * b || progress > 0.9) plan.push({ chords: OUTRO, melody: null });
        else {
          plan.push({ chords: kind === "A" ? SECTION_A : SECTION_B, melody: phrases[kind] });
          next++;
          degree = 9;
        }
        view.say(barAt);
      }
      const current = plan[section];
      const root = current.chords[bar];
      bass(h, queue, view, root, barAt, 0.26, b * 3.2);
      chord(h, queue, view, root, barAt + b, 0.17, b * 2.2);
      if (current.melody) {
        const phrase = current.melody[Math.floor(bar / 4) % current.melody.length];
        const events = phrase.bars[bar % 4];
        events.forEach((e, i) => {
          degree = Math.min(Math.max(degree + (i === 0 && bar % 4 === 0 ? 0 : e.step), 2), 11);
          // 節の終わりは、今の和音の音に落ち着かせる
          if (bar % 4 === 3) {
            const tones = [root, root + 2, root + 4, root + 7, root + 9].map((d) => d % 7 + 7 * Math.floor(degree / 7));
            degree = tones.reduce((best, d) => (Math.abs(d - degree) < Math.abs(best - degree) ? d : best), tones[0]);
          }
          const velocity = 0.3 * random(0.92, 1.08) * (1 + 0.15 * Math.sin(Math.PI * Math.min(progress, 1)));
          note(h, queue, view, h.centre + h.degree(degree), barAt + e.at * b, velocity, e.beats * b * 1.25, MELODY);
        });
      }
      bar++;
      barAt += 3 * b;
    });

    return {
      pointer: (_x, y, height) => !ending && softAt(ctx, queue, view, y, height),
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

// --- II. 小節線のない歌 ---

type Note = { degree: number; beats: number; turn: boolean };

// 短い節: 中心の 5 度上あたりを、隣の音へ動きながらうろつき、最後は長い音で止まる。ときどき回り込む飾り（上・元・下）が付く
function newMotif(): Note[] {
  const length = 4 + Math.floor(rand() * 4);
  let degree = 4 + Math.floor(rand() * 3);
  return Array.from({ length }, (_, i) => {
    if (i > 0) degree = Math.min(Math.max(degree + [-1, -1, 1, 1, -2, 2, 0][Math.floor(rand() * 7)], 0), 8);
    const last = i === length - 1;
    const beats = last ? [2, 3][Math.floor(rand() * 2)] : [0.5, 0.5, 1, 1, 1, 1.5][Math.floor(rand() * 6)];
    return { degree, beats, turn: !last && rand() < 0.3 };
  });
}

const song: Movement = {
  title: { ja: "II. 小節線のない歌", en: "II. Song without bar lines" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const beat = () => 110 / ctx.bpm();
    const motifs = [newMotif(), newMotif(), newMotif()];
    // 節を並べる順番。最初の節がよく戻ってくる
    const pick = () => [0, 0, 0, 1, 1, 2][Math.floor(rand() * 6)];
    let motif = 0;
    let position = 0;
    let melodyAt = startAt + 0.5 + 4 * beat(); // 左手が 2 回刻んでから入る
    let leftAt = startAt + 0.5;
    let leftStep = 0;
    let root = 0;
    let pauseUntil = -Infinity; // 両手が立ち止まっている間
    let finalMotif = false;
    let ending = false;
    view.say(melodyAt);

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = layout(ctx);
      const b = beat();

      // 左手: 1 拍目に低い音、2 拍目に和音を、同じ形で刻み続ける（立ち止まっている間は休む）
      while (leftAt < time + TICK) {
        if (leftAt < pauseUntil) {
          leftAt = pauseUntil;
          leftStep = 0;
          continue;
        }
        if (leftStep % 2 === 0) bass(h, queue, view, root, leftAt, 0.24, b * 2.2);
        else chord(h, queue, view, root, leftAt, 0.15, b * 1.2);
        leftStep++;
        leftAt += b;
      }

      // 飾りの付いた音は、飾りの分だけ早く用意する（飾りの時刻が過ぎてからでは、飾りと本当の音が同時に鳴ってしまう）
      const notes = motifs[motif];
      const lead = notes[position]?.turn ? TURN_LEAD : 0;
      if (melodyAt - lead >= time + TICK) return;
      const progress = (melodyAt - startAt) / song.duration;
      if (position >= notes.length) {
        position = 0;
        if (finalMotif) {
          // 終わり: 左手の低い音と和音を長く置く
          ending = true;
          bass(h, queue, view, 0, melodyAt, 0.26, b * 6);
          chord(h, queue, view, 0, melodyAt + b * 0.5, 0.16, b * 6);
          endAt = melodyAt + b * 7;
          return;
        }
        // 節のあいだで、ときどき両手とも立ち止まる
        if (rand() < 0.25) {
          const rest = b * random(2, 4);
          pauseUntil = melodyAt + rest;
          melodyAt += rest;
          view.say(melodyAt);
        }
        if (progress >= 0.9) {
          finalMotif = true;
          motif = 0;
        } else motif = pick();
        // 和音はふだん主和音のまま。ときどき 5 度や 4 度の和音へ移り、また戻る
        root = root !== 0 ? 0 : rand() < 0.3 ? [3, 4][Math.floor(rand() * 2)] : 0;
        return;
      }
      const n = notes[position];
      const at = melodyAt;
      const index = h.centre + h.degree(n.degree);
      const velocity = 0.3 * random(0.92, 1.08);
      if (n.turn) {
        // 飾り: 本当の音の少し前に、上・元・下の 3 音を素早く入れる
        [1, 0, -1].forEach((d, i) => note(h, queue, view, index + h.degree(d), at - TURN_LEAD + i * (TURN_LEAD / 3), velocity * 0.6, 0.2, MELODY));
      }
      note(h, queue, view, index, at, velocity, n.beats * b * 1.2, MELODY);
      position++;
      melodyAt += n.beats * b;
    });

    return {
      pointer: (_x, y, height) => !ending && softAt(ctx, queue, view, y, height),
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

// --- III. 家具の音楽 ---

const PROGRESSIONS = [
  [0, 0, 4, 0],
  [0, 3, 4, 0],
  [5, 1, 4, 0],
  [0, 5, 3, 4],
  [3, 0, 4, 0],
];

type Loop = { progression: number[]; cell: { at: number; degree: number }[]; repeats: number };

// ループ: 2/4 拍子の 4 小節。左手は低い音と和音を交互に、右手は 2 小節の短い型を 2 回弾く
function newLoop(): Loop {
  const cell: { at: number; degree: number }[] = [];
  let degree = 2 + Math.floor(rand() * 5);
  for (let at = 0; at < 4; at += rand() < 0.6 ? 0.5 : 1) {
    if (rand() < 0.15) continue; // 休み
    cell.push({ at, degree });
    degree = Math.min(Math.max(degree + [-1, 1, -2, 2, 0][Math.floor(rand() * 5)], 0), 9);
  }
  return { progression: PROGRESSIONS[Math.floor(rand() * PROGRESSIONS.length)], cell, repeats: 5 + Math.floor(rand() * 5) };
}

const furniture: Movement = {
  title: { ja: "III. 家具の音楽", en: "III. Furniture music" },
  duration: 270,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const beat = () => 60 / ctx.bpm();
    const first = newLoop();
    let current = first;
    let repeatsLeft = current.repeats;
    let loopAt = startAt + 0.5;
    let returning = false;
    let ending = false;
    view.say(loopAt);

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending || loopAt >= time + TICK) return;
      const h = layout(ctx);
      const b = beat();
      const progress = (loopAt - startAt) / furniture.duration;

      if (repeatsLeft === 0) {
        if (returning) {
          // 終わり: 何の前触れもなく、低い音と和音を 1 つ短く置いて止める
          ending = true;
          bass(h, queue, view, 0, loopAt, 0.3, b);
          chord(h, queue, view, 0, loopAt, 0.2, b);
          endAt = loopAt + 2;
          return;
        }
        // 前触れなく、別のループへ移る。終わり近くでは最初のループに戻り、2 回弾いて終える
        if (progress >= 0.88) {
          returning = true;
          current = first;
          repeatsLeft = 2;
        } else {
          current = newLoop();
          repeatsLeft = current.repeats;
        }
        view.say(loopAt);
      }

      // 4 小節（8 拍）を 1 回
      current.progression.forEach((root, bar) => {
        const at = loopAt + bar * 2 * b;
        bass(h, queue, view, root, at, 0.26, b * 0.9);
        chord(h, queue, view, root, at + b, 0.16, b * 0.7);
      });
      for (const half of [0, 4]) {
        for (const c of current.cell) {
          const at = loopAt + (half + c.at) * b;
          note(h, queue, view, h.centre + h.degree(c.degree), at, 0.27 * random(0.92, 1.08), b * 0.8, MELODY);
        }
      }
      loopAt += 8 * b;
      repeatsLeft--;
    });

    return {
      pointer: (_x, y, height) => !ending && softAt(ctx, queue, view, y, height),
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

export const satie: Sonata = {
  id: "satie",
  composer: { ja: "エリック・サティ", en: "Erik Satie" },
  initials: "E.S.",
  // ドリアン。旋法の素朴な響きで、IV の和音が長三和音になる（I の揺り返しに使う）
  scale: DORIAN,
  movements: [dance, song, furniture],
};
