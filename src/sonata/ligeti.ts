import * as Tone from "tone";
import { t } from "../i18n";
import { pitchIndexAt } from "../scales";
import { CHROMATIC, flowView, type HueMark, layout, MARGIN_LEFT, MARGIN_RIGHT, type Movement, type MovementContext, pendingQueue, rand, random, scheduler, type Sonata, TICK, yOf } from "./movement";

// ジェルジ・リゲティがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// I.   一音から: 最初は 1 つの音名だけで、区切りごとに使える音名を 1 つずつ増やす。だんだん速くなり、最後の音名は最後の 1 音まで取っておく
// II.  止まっていくメトロノーム: たくさんのメトロノーム（1 つが 1 音）が、それぞれの速さで一斉に刻み始め、ねじが切れたものから止まっていく
// III. 無秩序: 右手は白鍵、左手は黒鍵だけで、休まず同じ速さで刻み、強い音で旋律を浮かべる。右手はときどき 1 拍縮んで左手とずれていき、
//      両手とも高いほうへ登りつめて、突然終わる
// 時刻はすべて音の時計で持つ

// --- 画面: 鳴った音が右端から左へ流れる。強い音ほど大きい ---

const WINDOW = 10;

const markView = (ctx: MovementContext) =>
  flowView<HueMark>(ctx, WINDOW, (g, m, x, y, ringing, fade, _span, note) => {
    g.fillStyle = `hsla(${m.hue}, 70%, ${55 + 25 * ringing}%, ${(0.25 + 0.6 * ringing) * fade})`;
    note(2 * (1.5 + 7 * m.velocity + 2 * ringing));
  });

// --- I. 一音から ---

const repeatedNote: Movement = {
  title: { ja: "I. 一音から", en: "I. From a single note" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const h0 = layout(ctx, 12);
    // 音名（主音からの段数）を加える順番。最初は 5 度、最後は主音で、そのあいだはくじで決める
    const fifth = Math.round((7 * h0.perOctave) / 12);
    const middle = Array.from({ length: h0.perOctave }, (_, i) => i).filter((c) => c !== 0 && c !== fifth).sort(() => rand() - 0.5);
    const order = [fifth, ...middle, 0];
    const sections = order.length - 1; // 最後の音名（主音）は、終わりの 1 音だけに使う
    let unlocked = 1;
    let arrivedAt = startAt; // 新しい音名が加わった時刻
    let stepAt = startAt + 0.5;
    let last = -1;
    let group = 0; // 拍の組（2 つか 3 つ）の中の位置
    let groupLength = 2;
    let ending = false;

    // 音名 c の、画面上の音の位置
    const indicesOf = (c: number) => {
      const h = layout(ctx, 12);
      return Array.from({ length: h.count }, (_, i) => i).filter((i) => (((i - h.lowRoot) % h.perOctave) + h.perOctave) % h.perOctave === c);
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      while (stepAt < time + TICK) {
        const at = stepAt;
        const progress = (at - startAt) / repeatedNote.duration;
        // だんだん速くなる（始めは設定のテンポの 0.7 倍、終わり近くで 1.6 倍）
        const eighth = 30 / ctx.bpm() / (0.7 + 0.9 * Math.min(progress / 0.9, 1));

        // 区切りごとに、音名を 1 つ加える
        const due = Math.min(sections, 1 + Math.floor((progress / 0.9) * sections));
        let arriving = false;
        if (due > unlocked) {
          unlocked = due;
          arrivedAt = at;
          arriving = true;
        }

        // 終わり: 少し間を置き、取っておいた主音を、低い所でオクターブを重ねて鳴らす
        if (progress >= 0.92) {
          ending = true;
          const h = layout(ctx, 12);
          const final = at + eighth * 3;
          for (const octave of [-1, 0]) {
            const index = h.lowRoot;
            queue.add({ time: final, index, octave, velocity: 0.6, seconds: 6, onPlay: view.add({ time: final, index: index + octave * h.perOctave, hue: 0, seconds: 6, velocity: 0.6 }) });
          }
          endAt = final + 7;
          return;
        }

        const available = order.slice(0, unlocked);
        const newest = available.at(-1)!;
        // 加わったばかりの音名は、オクターブを重ねて強く鳴らし、しばらくはよく使う
        const fresh = at - arrivedAt < 8;
        let index: number;
        if (arriving) index = indicesOf(newest)[Math.floor(indicesOf(newest).length / 2)] ?? 0;
        else if (last >= 0 && rand() < 0.35) index = last; // 同じ音を打ち続ける
        else {
          const c = fresh && rand() < 0.5 ? newest : available[Math.floor(rand() * available.length)];
          const candidates = indicesOf(c);
          // 使う音域は、時間とともに広がる
          const reach = 0.25 + 0.75 * progress;
          const near = candidates.filter((i) => Math.abs(i / ctx.pitches().length - 0.5) <= reach / 2);
          const pool = near.length ? near : candidates;
          index = pool[Math.floor(rand() * pool.length)] ?? 0;
        }
        const accent = group === 0;
        const play = arriving || rand() < 0.6 + 0.3 * progress || accent;
        if (play) {
          const velocity = (arriving ? 0.6 : accent ? 0.4 : 0.25) * (0.7 + 0.5 * progress) * random(0.9, 1.1);
          const seconds = eighth * (arriving ? 6 : 1.4);
          queue.add({ time: at, index, velocity, seconds, onPlay: view.add({ time: at, index, hue: arriving ? 0 : 200, seconds, velocity }) });
          if (arriving) queue.add({ time: at, index, octave: -1, velocity: velocity * 0.8, seconds });
          last = index;
        }
        group++;
        if (group >= groupLength) {
          group = 0;
          groupLength = rand() < 0.6 ? 2 : 3;
        }
        stepAt += eighth;
      }
    });

    return {
      pointer(_x, y, height) {
        if (ending) return;
        // その高さに近い、もう使える音名の音を鳴らす
        const h = layout(ctx, 12);
        const clicked = pitchIndexAt(y, height, h.count);
        const candidates = order.slice(0, unlocked).flatMap(indicesOf);
        const index = candidates.reduce((best, i) => (Math.abs(i - clicked) < Math.abs(best - clicked) ? i : best), candidates[0] ?? 0);
        const time = Tone.now() + 0.02;
        queue.add({ time, index, velocity: 0.45, seconds: 1, onPlay: view.add({ time, index, hue: 45, seconds: 1, velocity: 0.45 }) });
      },
      draw(g, width, height) {
        view.draw(g, width, height);
        // 上端に音名の数だけ枠を並べ、使えるようになった音名を明るくする（最後の枠が、取っておいた主音）
        const total = order.length;
        for (let i = 0; i < total; i++) {
          g.fillStyle = i < unlocked ? (i === unlocked - 1 ? "hsla(0, 70%, 65%, 0.9)" : "rgba(255, 255, 255, 0.5)") : "rgba(255, 255, 255, 0.1)";
          g.fillRect(MARGIN_LEFT + i * 16, 10, 12, 4);
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

// --- II. 止まっていくメトロノーム ---

type Metronome = { index: number; period: number; nextAt: number; startedAt: number; stopAt: number; velocity: number; lastTick: number };

const metronomes: Movement = {
  title: { ja: "II. 止まっていくメトロノーム", en: "II. Metronomes winding down" },
  duration: 270,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const h = layout(ctx, 12);
    const tempo = 132 / ctx.bpm();
    // メトロノームの数は密度で決まる。止まる時刻はばらばらで、最後の 1 つだけが終わり近くまで残る
    const total = Math.min(40, Math.max(8, Math.round(20 * Math.sqrt(ctx.density()))));
    const stops = Array.from({ length: total - 1 }, () => random(0.12, 0.8)).sort((a, b) => a - b);
    stops.push(0.96);
    const band: Metronome[] = stops.map((stop) => {
      const at = startAt + 0.5 + random(0, 1.5);
      return {
        index: Math.round(random(0.15, 0.85) * (h.count - 1)),
        period: random(0.3, 2) * tempo,
        nextAt: at,
        startedAt: at,
        stopAt: startAt + stop * metronomes.duration,
        velocity: random(0.1, 0.2),
        lastTick: -Infinity,
      };
    });
    // 画面では、高さの順に横へ並べる
    const order = [...band].sort((a, b) => a.index - b.index);
    let ending = false;

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      for (const m of band) {
        while (m.nextAt < time + TICK && m.nextAt < m.stopAt) {
          const at = m.nextAt;
          queue.add({ time: at, index: m.index, velocity: m.velocity, seconds: 0.15, onPlay: () => (m.lastTick = at) });
          m.nextAt += m.period;
        }
      }
      if (band.every((m) => m.nextAt >= m.stopAt) && time > band.at(-1)!.stopAt) {
        ending = true;
        endAt = time + 3;
      }
    });

    return {
      pointer(_x, y, height) {
        if (ending) return;
        // その高さに、新しいメトロノームを 1 つねじを巻いて加える（20 回ほど刻んで止まる）
        const index = Math.min(Math.max(pitchIndexAt(y, height, h.count), 0), h.count - 1);
        const period = (0.3 + Math.random() * 1.2) * tempo;
        const at = Tone.now() + 0.02;
        const m = { index, period, nextAt: at, startedAt: at, stopAt: at + period * 20, velocity: 0.18, lastTick: -Infinity };
        band.push(m);
        order.push(m);
        order.sort((a, b) => a.index - b.index);
      },
      draw(g, width, height) {
        // 振り子: 動いているあいだは左右に振れ、真上を通る瞬間に刻んで先が光る（1 回刻むごとに、右と左を入れ替える）。
        // 止まったものは真上で止まって薄くなる
        const now = Tone.now();
        const span = width - MARGIN_LEFT - MARGIN_RIGHT;
        order.forEach((m, i) => {
          const x = MARGIN_LEFT + ((i + 0.5) / order.length) * span;
          const y = yOf(m.index, height, h.count);
          const running = now < m.stopAt && now >= m.startedAt;
          const angle = running ? 0.6 * Math.sin((Math.PI * (now - m.startedAt)) / m.period) : 0;
          const length = 28;
          const tipX = x + Math.sin(angle) * length;
          const tipY = y - Math.cos(angle) * length;
          const flash = Math.max(0, 1 - (now - m.lastTick) / 0.2);
          g.strokeStyle = running ? "rgba(255, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.1)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(tipX, tipY);
          g.stroke();
          g.fillStyle = `hsla(30, 80%, ${50 + 30 * flash}%, ${running ? 0.4 + 0.6 * flash : 0.15})`;
          g.beginPath();
          g.arc(tipX, tipY, 3 + 3 * flash, 0, Math.PI * 2);
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

// --- III. 無秩序 ---

const WHITE = [0, 2, 4, 5, 7, 9, 11]; // 主音から見た「白鍵」（長音階の音）。残りの 5 つが「黒鍵」
const DROP_EVERY = 6; // 右手は、この回数ごとに 1 拍短い周期を挟む（左手より 1 拍ずつ先へずれていく）

// base と climb は旋律の始まりと、楽章のあいだに登る段数。contour は強拍ごとの小さな上下（その手の旋律の形）
type Hand = { notes: number[]; position: number; base: number; climb: number; contour: number[]; cycle: number; cycles: number; accents: number; octave: number; hue: number };

const disorder: Movement = {
  title: { ja: "III. 無秩序", en: "III. Disorder" },
  duration: 240,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const sixteenth = () => 15 / ctx.bpm();
    let stepAt = startAt + 0.5;
    let ending = false;

    // 手ごとの音の集まり（画面の外へも、オクターブを足して続く）
    const setOf = (white: boolean) => {
      const h = layout(ctx, 12);
      const all = Array.from({ length: h.count }, (_, i) => i);
      const picked = all.filter((i) => WHITE.includes(h.semitone(i)) === white);
      return picked.length >= 3 ? picked : all; // 半音階でない音階で集まりが小さすぎるときは、どちらの手も全部の音を使う
    };
    const member = (notes: number[], k: number) => {
      const per = notes.filter((i) => i - notes[0] < layout(ctx, 12).perOctave).length;
      const octave = Math.floor(k / per);
      return notes[((k % per) + per) % per] + octave * layout(ctx, 12).perOctave;
    };
    const perOf = (notes: number[]) => notes.filter((i) => i - notes[0] < layout(ctx, 12).perOctave).length;
    const contour = () => Array.from({ length: 6 + Math.floor(rand() * 5) }, () => Math.floor(rand() * 4));
    // 旋律の始まり: 右手は真ん中から 2 オクターブ、左手は低い所から 3 オクターブ登る
    const whites = setOf(true);
    const blacks = setOf(false);
    const right: Hand = { notes: whites, position: 0, base: Math.round(whites.length * 0.4), climb: 2 * perOf(whites), contour: contour(), cycle: 8, cycles: 0, accents: 0, octave: 1, hue: 50 };
    const left: Hand = { notes: blacks, position: 0, base: Math.round(blacks.length * 0.05), climb: 3 * perOf(blacks), contour: contour(), cycle: 8, cycles: 0, accents: 0, octave: -1, hue: 280 };
    const melodyOf = (hand: Hand, progress: number) =>
      hand.base + Math.round(hand.climb * Math.min(progress, 1) ** 1.5) + hand.contour[hand.accents % hand.contour.length];

    const play = (hand: Hand, at: number, progress: number) => {
      const h = layout(ctx, 12);
      const energy = 0.6 + 0.6 * Math.min(progress, 1);
      // 強拍（周期の頭と 4 つ目）で旋律の音を、オクターブを重ねて強く鳴らす。ほかの拍は旋律の下（上）を細かく埋める
      const accent = hand.position === 0 || hand.position === 3;
      if (accent) {
        // 旋律は、その手の小さな上下を繰り返しながら、楽章を通して少しずつ登っていく
        hand.accents++;
        const index = member(hand.notes, melodyOf(hand, progress));
        const velocity = Math.min(0.85, 0.42 * energy);
        for (const extra of [0, hand.octave]) {
          const placed = h.place(index + extra * h.perOctave);
          const onPlay = extra === 0 ? view.add({ time: at, index, hue: hand.hue, seconds: sixteenth() * 4, velocity }) : undefined;
          queue.add({ time: at, ...placed, velocity: extra === 0 ? velocity : velocity * 0.8, seconds: sixteenth() * 4, onPlay });
        }
      } else {
        // 右手は旋律の下を、左手は旋律の上を埋める
        const index = member(hand.notes, melodyOf(hand, progress) - [2, 1, 3, 1, 2][hand.position % 5] * (hand.octave > 0 ? 1 : -1));
        const placed = h.place(index);
        const velocity = 0.15 * energy * random(0.85, 1.1);
        queue.add({ time: at, ...placed, velocity, seconds: sixteenth() * 1.3, onPlay: view.add({ time: at, index, hue: hand.hue, seconds: sixteenth() * 1.5, velocity }) });
      }
      hand.position++;
      if (hand.position >= hand.cycle) {
        hand.position = 0;
        hand.cycles++;
      }
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      if (ending) return;
      while (stepAt < time + TICK) {
        const at = stepAt;
        const progress = (at - startAt) / disorder.duration;
        // 終わり: 両手を鍵盤の両端で強く打って、突然終える
        if (progress >= 0.96) {
          ending = true;
          const h = layout(ctx, 12);
          for (const [index, octave] of [
            [h.count - 1, 1],
            [h.count - 1, 0],
            [0, -1],
            [0, -2],
          ]) {
            queue.add({ time: at, index, octave, velocity: 0.8, seconds: 2.5, onPlay: view.add({ time: at, index: index + octave * h.perOctave, hue: 0, seconds: 2.5, velocity: 0.8 }) });
          }
          endAt = at + 3;
          return;
        }
        play(right, at, progress);
        play(left, at, progress);
        // 右手の周期: DROP_EVERY 回ごとに、次の 1 回だけ 1 拍短くする
        if (right.position === 0) right.cycle = right.cycles % DROP_EVERY === DROP_EVERY - 1 ? 7 : 8;
        stepAt += sixteenth();
      }
    });

    return {
      pointer(_x, y, height) {
        if (ending) return;
        // その高さに、オクターブを重ねた強い音を 1 つ打ち込む
        const h = layout(ctx, 12);
        const index = Math.min(Math.max(pitchIndexAt(y, height, h.count), 0), h.count - 1);
        const time = Tone.now() + 0.02;
        queue.add({ time, index, velocity: 0.55, seconds: 1, onPlay: view.add({ time, index, hue: 0, seconds: 1, velocity: 0.55 }) });
        queue.add({ time, index, octave: -1, velocity: 0.45, seconds: 1 });
      },
      draw(g, width, height) {
        view.draw(g, width, height);
        // 上端に、右手が左手より何拍先へずれたかを出す（8 拍でひと回りして、強拍がまた重なる）
        const shift = Math.floor(right.cycles / DROP_EVERY);
        g.font = "12px system-ui, sans-serif";
        g.textAlign = "left";
        g.fillStyle = "rgba(255, 255, 255, 0.5)";
        g.fillText(`${t({ ja: "右手のずれ", en: "Right hand ahead by" })} ${shift % 8} / 8`, MARGIN_LEFT, 20);
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

export const ligeti: Sonata = {
  id: "ligeti",
  composer: { ja: "ジェルジ・リゲティ", en: "György Ligeti" },
  initials: "G.L.",
  // 半音階。I は音名を 1 つずつ加え、III は白鍵と黒鍵に両手を分ける
  scale: CHROMATIC,
  movements: [repeatedNote, metronomes, disorder],
};
