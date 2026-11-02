import * as Tone from "tone";
import { pitchIndexAt } from "../scales";
import { AEOLIAN, MARGIN_LEFT, MARGIN_RIGHT, type Movement, type MovementContext, pendingQueue, rand, random, scheduler, type Sonata, TICK, yOf } from "./movement";

// アルヴォ・ペルトがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方（ティンティナブリ）だけを借りている。
// ティンティナブリ: 音階を順に動く旋律（M 声部）に、主和音の音だけを弾く声部（T 声部）が規則で付く。
// T 声部は、旋律のすぐ上（またはすぐ下）にある主和音の音を弾く。
// I.   ティンティナブリ: 中心の音へ向かう句が、上から・下からと交互に来て、1 音ずつ長くなり、また短くなる
// II.  鐘とカノン: 同じ下行の句を、1・2・4 倍の遅さで 3 つの声部が重ね、鐘が鳴る。最後は声部が主音に着いて止まる
// III. 鏡: 2 つの旋律が中心の音から鏡のように上下へ開いては閉じ、左手が主和音を分散して刻み続ける
// 時刻はすべて音の時計で持ち、テンポの設定で 1 音の長さが決まる

// 今の音高の並びでの、主和音の音（音階の 1・3・5 番目の音）と、中心の主音
function harmony(ctx: MovementContext) {
  const pitches = ctx.pitches();
  const count = pitches.length;
  const roots = pitches.flatMap((p, i) => (p.isRoot ? [i] : []));
  const perOctave = roots.length >= 2 ? roots[1] - roots[0] : 7;
  const first = roots[0] ?? 0;
  const degree = (i: number) => (((i - first) % perOctave) + perOctave) % perOctave;
  const isTriad = (i: number) => degree(i) === 0 || degree(i) === 2 || degree(i) === 4;
  const superior = (i: number) => {
    for (let j = i + 1; j < count; j++) if (isTriad(j)) return j;
    return i;
  };
  const inferior = (i: number) => {
    for (let j = i - 1; j >= 0; j--) if (isTriad(j)) return j;
    return i;
  };
  const centre = roots.reduce((best, r) => (Math.abs(r - count / 2) < Math.abs(best - count / 2) ? r : best), roots[0] ?? Math.floor(count / 2));
  return { count, perOctave, isTriad, superior, inferior, centre, lowRoot: first, isRoot: (i: number) => pitches[i]?.isRoot ?? false };
}

// --- 画面: 鳴った音が右端から左へ流れる。M 声部は金の点、T 声部は青い輪で、同時に鳴る M と T を細い線で結ぶ ---

type Trace = { time: number; index: number; kind: "m" | "t" | "bell"; seconds: number; partner?: number };
const WINDOW = 24;

function traceView(ctx: MovementContext) {
  let traces: Trace[] = [];
  return {
    add: (tr: Trace) => () => traces.push(tr),
    clear: () => (traces = []),
    draw(g: CanvasRenderingContext2D, width: number, height: number) {
      const now = Tone.now();
      traces = traces.filter((tr) => now - tr.time < WINDOW);
      const count = ctx.pitches().length;
      const span = width - MARGIN_LEFT - MARGIN_RIGHT;
      const xOf = (time: number) => width - MARGIN_RIGHT - ((now - time) / WINDOW) * span;
      for (const tr of traces) {
        const x = xOf(tr.time);
        if (x < MARGIN_LEFT) continue;
        const y = yOf(tr.index, height, count);
        const fade = 1 - (now - tr.time) / WINDOW;
        const ringing = Math.max(0, 1 - (now - tr.time) / tr.seconds);
        if (tr.kind === "bell") {
          g.strokeStyle = `hsla(200, 30%, 85%, ${0.5 * ringing})`;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(x, y, 6 + (1 - ringing) * 50, 0, Math.PI * 2);
          g.stroke();
          continue;
        }
        if (tr.kind === "m") {
          if (tr.partner !== undefined) {
            g.strokeStyle = `rgba(255, 255, 255, ${0.12 * fade})`;
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x, yOf(tr.partner, height, count));
            g.stroke();
          }
          g.fillStyle = `hsla(45, 70%, ${60 + 20 * ringing}%, ${(0.3 + 0.6 * ringing) * fade})`;
          g.beginPath();
          g.arc(x, y, 3 + 4 * ringing, 0, Math.PI * 2);
          g.fill();
        } else {
          g.strokeStyle = `hsla(210, 60%, 75%, ${(0.25 + 0.6 * ringing) * fade})`;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y, 4 + 3 * ringing, 0, Math.PI * 2);
          g.stroke();
        }
      }
    },
  };
}

// クリック: その高さに近い主和音の音で、鐘を 1 つ鳴らす（すぐ上の主和音の音を重ねる）
function bellAt(ctx: MovementContext, queue: ReturnType<typeof pendingQueue>, view: ReturnType<typeof traceView>, y: number, height: number) {
  const h = harmony(ctx);
  const clicked = Math.min(Math.max(pitchIndexAt(y, height, h.count), 0), h.count - 1);
  const index = h.isTriad(clicked) ? clicked : h.inferior(clicked);
  const time = Tone.now() + 0.02;
  queue.add({ time, index, velocity: 0.35, seconds: 6, onPlay: view.add({ time, index, kind: "bell", seconds: 6 }) });
  queue.add({ time, index: h.superior(index), velocity: 0.2, seconds: 6 });
}

// --- I. ティンティナブリ ---

const MAX_PHRASE = 8;

const tintinnabuli: Movement = {
  title: { ja: "I. ティンティナブリ", en: "I. Tintinnabuli" },
  duration: 300,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = traceView(ctx);
    let nextAt = startAt + 0.5;
    let length = 1; // 句の音の数
    let fromAbove = true; // 上から中心へ降りる句か、下から昇る句か
    let ending = false;
    const unit = () => 120 / ctx.bpm(); // 1 音は 2 拍

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending || nextAt >= time + TICK) return;
      const h = harmony(ctx);
      const progress = (nextAt - startAt) / tintinnabuli.duration;
      const u = unit();
      const dynamics = 0.22 + 0.25 * Math.sin(Math.PI * Math.min(progress, 1));

      // 句が 1 音に戻ったところで、中心の音に主和音を重ねて終える
      if ((progress >= 0.92 && length === 1 && fromAbove) || progress > 1.15) {
        ending = true;
        const seconds = 9;
        queue.add({ time: nextAt, index: h.centre, velocity: 0.3, seconds, onPlay: view.add({ time: nextAt, index: h.centre, kind: "m", seconds }) });
        for (const index of [h.inferior(h.centre), h.superior(h.centre)])
          queue.add({ time: nextAt, index, octave: -1, velocity: 0.2, seconds, onPlay: view.add({ time: nextAt, index, kind: "t", seconds }) });
        queue.add({ time: nextAt, index: h.lowRoot, octave: -1, velocity: 0.25, seconds });
        endAt = nextAt + 10;
        return;
      }

      // 上からの句は中心の上から 1 段ずつ降り、下からの句は中心の下から昇る。どちらも中心の音で終わる
      const reach = Math.min(length - 1, fromAbove ? h.count - 1 - h.centre : h.centre);
      const notes = Array.from({ length: reach + 1 }, (_, i) => (fromAbove ? h.centre + reach - i : h.centre - reach + i));
      // 上からの句の頭で、低い主音を鐘のように鳴らす
      if (fromAbove) {
        const at = nextAt;
        queue.add({ time: at, index: h.lowRoot, octave: -1, velocity: dynamics * 0.8, seconds: u * 6, onPlay: view.add({ time: at, index: h.lowRoot, kind: "bell", seconds: u * 6 }) });
      }
      notes.forEach((m, i) => {
        const at = nextAt + i * u;
        const last = i === notes.length - 1;
        // T 声部は、すぐ下とすぐ上の主和音の音を交互に（1 オクターブ下、左手で）
        const t = i % 2 === 0 ? h.inferior(m) : h.superior(m);
        const seconds = (last ? 2 : 1) * u * 1.5;
        queue.add({ time: at, index: m, velocity: dynamics * (last ? 1.1 : 1), seconds, onPlay: view.add({ time: at, index: m, kind: "m", seconds, partner: t }) });
        queue.add({ time: at, index: t, octave: -1, velocity: dynamics * 0.7, seconds, onPlay: view.add({ time: at, index: t, kind: "t", seconds }) });
      });
      nextAt += (notes.length + 2) * u; // 最後の音を 2 倍に伸ばし、1 音分休む

      // 上と下の句を弾き終えたら、句の長さを 1 つ伸ばす（後半は縮める）。楽章の中ほどで最も長い
      if (!fromAbove) {
        const target = 1 + Math.round((MAX_PHRASE - 1) * Math.sin(Math.PI * Math.min(progress / 0.92, 1)));
        length += Math.sign(target - length);
      }
      fromAbove = !fromAbove;
    });

    return {
      pointer: (_x, y, height) => !ending && bellAt(ctx, queue, view, y, height),
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

// --- II. 鐘とカノン ---

type Voice = { speed: number; octave: number; length: number; position: number; nextAt: number; done: boolean };

const canon: Movement = {
  title: { ja: "II. 鐘とカノン", en: "II. Bells and canon" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = traceView(ctx);
    const unit = () => 60 / ctx.bpm(); // 一番速い声部の 1 音は 1 拍
    // 3 つの声部が同じ句を 1・2・4 倍の遅さで、1 オクターブずつ低く弾く。少しずつ遅れて入る
    const voices: Voice[] = [
      { speed: 1, octave: 0, length: 0, position: 0, nextAt: startAt + 0.5, done: false },
      { speed: 2, octave: -1, length: 0, position: 0, nextAt: startAt + 0.08 * canon.duration, done: false },
      { speed: 4, octave: -2, length: 0, position: 0, nextAt: startAt + 0.16 * canon.duration, done: false },
    ];
    let nextBell = startAt + 4;
    let tolls = 0;
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = harmony(ctx);
      const top = Math.min(h.centre + h.perOctave, h.count - 1);
      const lowest = Math.max(0, top - Math.round(h.perOctave * 1.5));

      for (const v of voices) {
        if (v.done || v.nextAt >= time + TICK) continue;
        const at = v.nextAt;
        const progress = (at - startAt) / canon.duration;
        const dynamics = 0.2 + 0.3 * Math.min(progress / 0.85, 1); // 終わり近くまで、少しずつ強くなる
        // 句: 上の音から 1 段ずつ降りる。1 音、2 音、3 音…と伸び、下まで来たら 1 音に戻る
        const index = top - v.position;
        const seconds = unit() * v.speed * 1.3;
        // 終わり: 主音に着いた声部から、その音を伸ばして止まる
        const arrive = progress >= 0.88 && h.isRoot(index);
        const s = arrive ? 10 : seconds;
        queue.add({ time: at, index, octave: v.octave, velocity: dynamics * (v.speed === 1 ? 0.8 : 1), seconds: s, onPlay: view.add({ time: at, index, kind: "m", seconds: s }) });
        // 一番速い声部には、すぐ上の主和音の音を T 声部として重ねる
        if (v.speed === 1) {
          const t = h.superior(index);
          queue.add({ time: at, index: t, velocity: dynamics * 0.45, seconds: s, onPlay: view.add({ time: at, index: t, kind: "t", seconds: s }) });
        }
        if (arrive || progress > 1.15) {
          v.done = true;
          continue;
        }
        v.nextAt += unit() * v.speed;
        v.position++;
        if (v.position > v.length) {
          v.position = 0;
          v.length = top - (v.length + 1) < lowest ? 0 : v.length + 1;
        }
      }

      // 鐘: 高い主和音の音を 3 回打ち、しばらく休む
      if (nextBell < time + TICK) {
        const index = h.isTriad(h.count - 1) ? h.count - 1 : h.inferior(h.count - 1);
        const at = nextBell;
        queue.add({ time: at, index, velocity: 0.22, seconds: 5, onPlay: view.add({ time: at, index, kind: "bell", seconds: 5 }) });
        queue.add({ time: at, index: h.inferior(index), velocity: 0.15, seconds: 5 });
        tolls++;
        nextBell += tolls % 3 === 0 ? unit() * random(8, 12) : unit() * 2;
      }

      if (voices.every((v) => v.done)) {
        // すべての声部が主音に着いたら、最後の鐘を鳴らして終える
        ending = true;
        const at = Math.max(...voices.map((v) => v.nextAt), time);
        queue.add({ time: at + 1, index: h.centre, velocity: 0.3, seconds: 9, onPlay: view.add({ time: at + 1, index: h.centre, kind: "bell", seconds: 9 }) });
        queue.add({ time: at + 1, index: h.lowRoot, octave: -1, velocity: 0.25, seconds: 9 });
        endAt = at + 11;
      }
    });

    return {
      pointer: (_x, y, height) => !ending && bellAt(ctx, queue, view, y, height),
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

// --- III. 鏡 ---

const MIRROR_END = 0.92;

const mirror: Movement = {
  title: { ja: "III. 鏡", en: "III. Mirror" },
  duration: 270,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = traceView(ctx);
    const eighth = () => 30 / ctx.bpm();
    let arpeggioAt = startAt + 0.5;
    let arpeggioStep = 0;
    let melodyAt = startAt + 0.5 + 8 * eighth(); // 左手が 1 小節刻んでから入る
    let distance = 0; // 中心の音からの開き
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      const h = harmony(ctx);

      // 左手: 低い主和音を分散して 8 分音符で刻み続ける（根音・5 度・3 度・5 度）
      if (arpeggioAt < time + TICK) {
        const progress = (arpeggioAt - startAt) / mirror.duration;
        const triad = [h.lowRoot, h.superior(h.lowRoot), h.superior(h.superior(h.lowRoot))];
        const index = triad[[0, 2, 1, 2][arpeggioStep % 4]];
        const velocity = 0.12 + 0.18 * Math.sin(Math.PI * Math.min(progress, 1));
        const at = arpeggioAt;
        queue.add({ time: at, index, octave: -1, velocity, seconds: eighth() * 2, onPlay: view.add({ time: at, index, kind: "t", seconds: eighth() * 2 }) });
        arpeggioStep++;
        arpeggioAt += eighth();
      }

      if (melodyAt >= time + TICK) return;
      const at = melodyAt;
      const progress = (at - startAt) / mirror.duration;
      const dynamics = 0.25 + 0.3 * Math.sin(Math.PI * Math.min(progress, 1));
      // 2 つの旋律は、中心から同じだけ上と下へ。開ける幅は中ほどで最も広く、終わりに向けて閉じる
      const span = Math.round(1 + 5 * Math.sin(Math.PI * Math.min(progress / MIRROR_END, 1)));
      if ((progress >= MIRROR_END && distance === 0) || progress > 1.15) {
        ending = true;
        const seconds = 8;
        for (const index of [h.centre, h.inferior(h.centre), h.superior(h.centre)])
          queue.add({ time: at, index, velocity: 0.3, seconds, onPlay: view.add({ time: at, index, kind: index === h.centre ? "m" : "t", seconds }) });
        queue.add({ time: at, index: h.lowRoot, octave: -1, velocity: 0.28, seconds });
        endAt = at + 9;
        return;
      }
      // 終わりに入ったら 1 段ずつ閉じ、中心で重なった次の音で終える
      if (progress >= MIRROR_END) distance = Math.max(0, distance - 1);
      else if (distance > span) distance--;
      else if (distance === 0) distance = 1;
      else distance += distance >= span || rand() < 0.4 ? -1 : 1;

      const upper = Math.min(h.centre + distance, h.count - 1);
      const lower = Math.max(h.centre - distance, 0);
      const seconds = eighth() * 4 * 1.4;
      queue.add({ time: at, index: upper, velocity: dynamics, seconds, onPlay: view.add({ time: at, index: upper, kind: "m", seconds, partner: lower }) });
      if (lower !== upper) queue.add({ time: at, index: lower, velocity: dynamics * 0.85, seconds, onPlay: view.add({ time: at, index: lower, kind: "m", seconds }) });
      melodyAt += eighth() * 4;
    });

    return {
      pointer: (_x, y, height) => !ending && bellAt(ctx, queue, view, y, height),
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

export const paert: Sonata = {
  id: "paert",
  composer: { ja: "アルヴォ・ペルト", en: "Arvo Pärt" },
  initials: "A.P.",
  // 自然短音階。主和音（1・3・5 番目の音）は短三和音になる
  scale: AEOLIAN,
  movements: [tintinnabuli, canon, mirror],
};
