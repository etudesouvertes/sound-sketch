import * as Tone from "tone";
import { pitchAt, pitchIndexAt } from "../scales";
import { t } from "../i18n";
import { after, CHROMATIC, MARGIN_LEFT, MARGIN_RIGHT, type Movement, rand, random, type Sonata, yOf } from "./movement";

// 一柳慧がピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// I.  反復のずれ（『ピアノ・メディア』のころ）: 両手が長さの違う短い型を同じ刻みで繰り返し、重なり方がずれていく
// II. 間（ケージの影響を受けたころ）: ペダルを踏んだまま、偶然で決めた音がぽつんと鳴り、長い沈黙をはさむ
// III. トッカータ: 速い旋律が 1 周ごとに 1 音ずつ伸び（1、1-2、1-2-3…）、両手で交互に弾きながら音域が広がり、加速する

// 楽章の時間は、音の時計（AudioContext の時刻。Loop に渡される time と同じ）で測る。
// Transport の秒はテンポを変えると進み方が変わるので使わない
const elapsedOf = (startAt: number, time: number) => time - startAt;

// --- I. 反復のずれ ---

type Hand = {
  upper: boolean; // 右手は画面の上半分、左手は下半分の音高を使う
  pattern: number[]; // 手の音域の中での番号（0 が一番低い）
  position: number; // 次に鳴らす音の位置
  count: number; // 鳴らした音の数（アクセントの周期に使う）
  accentCycle: number;
  playing: number; // いま鳴っている音の位置（描画用）
  glow: number[]; // 音ごとの光の強さ（描画用）
  hue: number;
};

const MIN_LENGTH = 3;
const MAX_LENGTH = 12;
const LEFT_ENTERS = 0.08; // 左手が入る位置（楽章の長さに対する割合）
const ENDING_AT = 0.82; // ここから両手の長さを 5 と 6 に寄せ、頭がそろった瞬間に終える
const SETTLED_RIGHT = 5;

const shifting: Movement = {
  title: { ja: "I. 反復のずれ", en: "I. Shifting repetitions" },
  duration: 300,
  start(ctx) {
    const { transport, piano } = ctx;
    const startAt = Tone.now();
    let endAt = Infinity;
    let aligned = 0;

    const newHand = (upper: boolean, accentCycle: number, hue: number): Hand => ({
      upper, pattern: [], position: 0, count: 0, accentCycle, playing: -1, glow: [], hue,
    });
    const right = newHand(true, 3, 28);
    const left = newHand(false, 4, 200);
    const hands = [right, left];

    const rangeOf = (hand: Hand) => {
      const count = ctx.pitches().length;
      const half = Math.floor(count / 2);
      return hand.upper ? { base: half, size: count - half } : { base: 0, size: half };
    };
    const absoluteIndex = (hand: Hand, note: number) => {
      const { base, size } = rangeOf(hand);
      return base + Math.min(Math.max(note, 0), size - 1);
    };
    // 音域の中を上下しながら動く。曲が進むほど跳躍が大きくなる（最初は 1〜2 度、終盤は 1〜4 度）
    let maxStep = 2;
    const randomNote = (hand: Hand, from: number) => {
      const { size } = rangeOf(hand);
      for (;;) {
        const next = from + (1 + Math.floor(rand() * maxStep)) * (rand() < 0.5 ? -1 : 1);
        if (next >= 0 && next < size) return next;
      }
    };
    const generate = (hand: Hand, length: number) => {
      let note = 1 + Math.floor(rand() * (rangeOf(hand).size - 2));
      hand.pattern = [note];
      while (hand.pattern.length < length) hand.pattern.push((note = randomNote(hand, note)));
      hand.glow = hand.pattern.map(() => 0);
    };
    const length = 5 + Math.floor(rand() * 3);
    generate(right, length);
    generate(left, length + 1);

    const insertAt = (hand: Hand, at: number, note: number, glow = 0) => {
      hand.pattern.splice(at, 0, note);
      hand.glow.splice(at, 0, glow);
    };
    const removeAt = (hand: Hand, at: number) => {
      hand.pattern.splice(at, 1);
      hand.glow.splice(at, 1);
    };

    // 1 周したときに、ときどき型を変える。1 音足す・1 音抜く・頭を 1 つずらす・1 音を変える
    const mutate = (hand: Hand) => {
      const p = hand.pattern;
      const roll = rand();
      if (roll < 0.3 && p.length < MAX_LENGTH) {
        const at = Math.floor(rand() * (p.length + 1));
        insertAt(hand, at, randomNote(hand, p[Math.max(0, at - 1)]));
      } else if (roll < 0.6 && p.length > MIN_LENGTH) {
        removeAt(hand, Math.floor(rand() * p.length));
      } else if (roll < 0.8) {
        p.push(p.shift()!);
        hand.glow.push(hand.glow.shift()!);
      } else {
        const at = Math.floor(rand() * p.length);
        p[at] = randomNote(hand, p[at]);
      }
      hand.position %= p.length;
    };
    // 終盤: 右手 5 音・左手 6 音に 1 音ずつ寄せる（そろうと、30 拍ごとに両手の頭が重なる）
    const settle = (hand: Hand) => {
      const target = hand.upper ? SETTLED_RIGHT : SETTLED_RIGHT + 1;
      if (hand.pattern.length > target) removeAt(hand, Math.floor(rand() * hand.pattern.length));
      else if (hand.pattern.length < target) insertAt(hand, hand.pattern.length, randomNote(hand, hand.pattern[hand.pattern.length - 1]));
      hand.position %= hand.pattern.length;
    };
    const settled = () => right.pattern.length === SETTLED_RIGHT && left.pattern.length === SETTLED_RIGHT + 1;

    // 型が変わる頻度。始めは少なく、中ほどで多く、終盤は寄せるだけ
    const mutateChance = (progress: number) => Math.min(0.9, 0.2 * (0.3 + 1.7 * Math.sin(Math.PI * Math.min(progress / ENDING_AT, 1))) * ctx.density());
    // 強さ。弱く始め、7 割のところで最も強くなり、そのまま終わる
    const dynamics = (progress: number) => 0.4 + 0.6 * Math.min(progress / 0.7, 1);

    const finalChord = (time: number) => {
      const pitches = ctx.pitches();
      const top = pitchAt(pitches, absoluteIndex(right, right.pattern[0])).freq;
      const bass = pitchAt(pitches, absoluteIndex(left, left.pattern[0])).freq;
      for (const freq of [top, bass, bass / 2]) piano.triggerAttackRelease(freq, 5, time, 0.95);
      Tone.getDraw().schedule(() => (aligned = 1.5), time);
      endAt = time + 6;
    };

    const loop = new Tone.Loop((time) => {
      if (endAt !== Infinity) return;
      transport.bpm.value = ctx.bpm();
      const progress = elapsedOf(startAt, time) / shifting.duration;
      maxStep = progress < 0.3 ? 2 : progress < 0.6 ? 3 : 4;
      const bothAtStart = right.position === 0 && left.position === 0;
      // 頭がそろった瞬間に終える。そろわないまま長引いたら、そこで終える
      if ((progress >= ENDING_AT && settled() && bothAtStart) || progress > 1.2) {
        finalChord(time);
        return;
      }

      const sixteenth = Tone.Time("16n").toSeconds();
      for (const hand of hands) {
        if (!hand.upper && progress < LEFT_ENTERS) continue; // 左手は、入るまで頭で待つ
        const at = hand.position;
        const accent = hand.count % hand.accentCycle === 0;
        const velocity = (accent ? 0.9 : 0.55 + rand() * 0.08) * dynamics(progress) * (hand.upper ? 1 : 0.9);
        const freq = pitchAt(ctx.pitches(), absoluteIndex(hand, hand.pattern[at])).freq;
        piano.triggerAttackRelease(freq, sixteenth * 1.6, time + rand() * 0.006, velocity);
        Tone.getDraw().schedule(() => {
          hand.playing = at;
          if (at < hand.glow.length) hand.glow[at] = accent ? 1 : 0.7;
        }, time);

        hand.count++;
        hand.position = (at + 1) % hand.pattern.length;
        if (hand.position !== 0) continue;
        if (progress >= ENDING_AT) settle(hand);
        else if (rand() < mutateChance(progress)) mutate(hand);
      }
      if (bothAtStart && progress >= LEFT_ENTERS) Tone.getDraw().schedule(() => (aligned = 1), time);
    }, "16n").start(after(transport, 0.05));

    const drawHand = (g: CanvasRenderingContext2D, width: number, height: number, hand: Hand, alpha: number) => {
      const count = ctx.pitches().length;
      const p = hand.pattern;
      const step = (width - MARGIN_LEFT - MARGIN_RIGHT) / p.length;
      const xOf = (i: number) => MARGIN_LEFT + (i + 0.5) * step;
      const y = (note: number) => yOf(absoluteIndex(hand, note), height, count);

      g.strokeStyle = `hsla(${hand.hue}, 40%, 60%, ${0.25 * alpha})`;
      g.lineWidth = 1.5;
      g.beginPath();
      p.forEach((note, i) => (i === 0 ? g.moveTo(xOf(i), y(note)) : g.lineTo(xOf(i), y(note))));
      g.stroke();

      p.forEach((note, i) => {
        const glow = hand.glow[i] ?? 0;
        if (i === 0) {
          // 型の頭は、少し大きな輪で示す
          g.strokeStyle = `hsla(${hand.hue}, 60%, 70%, ${0.5 * alpha})`;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(xOf(i), y(note), 9, 0, Math.PI * 2);
          g.stroke();
        }
        g.fillStyle = `hsla(${hand.hue}, 80%, ${55 + 25 * glow}%, ${(0.35 + 0.65 * glow) * alpha})`;
        g.beginPath();
        g.arc(xOf(i), y(note), 3 + 5 * glow, 0, Math.PI * 2);
        g.fill();
        if (i === hand.playing) {
          g.strokeStyle = `hsla(${hand.hue}, 90%, 80%, ${0.9 * alpha})`;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(xOf(i), y(note), 12, 0, Math.PI * 2);
          g.stroke();
        }
      });
    };

    let last = performance.now();
    return {
      // クリックした高さの音を、その手が次に鳴らす位置に入れる（型が 1 音長くなり、ずれ方が変わる）。いっぱいなら置き換える
      pointer(_x, y, height) {
        if (endAt !== Infinity) return;
        const index = pitchIndexAt(y, height, ctx.pitches().length);
        const hand = index >= rangeOf(right).base ? right : left;
        const note = index - rangeOf(hand).base;
        if (hand.pattern.length < MAX_LENGTH) insertAt(hand, hand.position, note, 1);
        else {
          hand.pattern[hand.position] = note;
          hand.glow[hand.position] = 1;
        }
      },
      draw(g, width, height) {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        for (const hand of hands) hand.glow = hand.glow.map((v) => Math.max(0, v - dt * 3));
        aligned = Math.max(0, aligned - dt * 2);

        const count = ctx.pitches().length;
        const middle = yOf(rangeOf(right).base - 0.5, height, count);
        g.strokeStyle = `rgba(255, 255, 255, ${0.08 + 0.5 * Math.min(aligned, 1)})`;
        g.lineWidth = 1 + 2 * Math.min(aligned, 1);
        g.beginPath();
        g.moveTo(MARGIN_LEFT, middle);
        g.lineTo(width - MARGIN_RIGHT, middle);
        g.stroke();

        g.font = "12px system-ui, sans-serif";
        g.textAlign = "right";
        g.fillStyle = "rgba(255, 255, 255, 0.45)";
        g.fillText(`${t({ ja: "右手", en: "R.H." })} ${right.pattern.length}`, width - MARGIN_RIGHT, middle - 10);
        g.fillText(`${t({ ja: "左手", en: "L.H." })} ${left.pattern.length}`, width - MARGIN_RIGHT, middle + 20);

        const leftIn = (Tone.now() - startAt) / shifting.duration >= LEFT_ENTERS;
        drawHand(g, width, height, right, 1);
        drawHand(g, width, height, left, leftIn ? 1 : 0.25);
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
      },
    };
  },
};

// --- II. 間 ---

type Mark = { at: number; index: number; velocity: number; life: number };

const silences: Movement = {
  title: { ja: "II. 間", en: "II. Ma (silence)" },
  duration: 240,
  start(ctx) {
    const { transport, piano } = ctx;
    const startAt = Tone.now();
    let endAt = Infinity;
    let marks: Mark[] = [];
    const scheduled: number[] = [];

    const play = (time: number, index: number, velocity: number, seconds: number) => {
      const pitches = ctx.pitches();
      const clamped = Math.min(Math.max(index, 0), pitches.length - 1);
      piano.triggerAttackRelease(pitchAt(pitches, clamped).freq, seconds, time, velocity);
      const at = elapsedOf(startAt, time) / silences.duration;
      Tone.getDraw().schedule(() => marks.push({ at, index: clamped, velocity, life: 1 }), time);
    };

    // 偶然で決める出来事。単音、遠く離れた 2 音、隣り合う 3 音の固まり（静かに）のどれか
    const event = (time: number) => {
      const count = ctx.pitches().length;
      const seconds = random(6, 10); // ペダルを踏んだまま
      const roll = rand();
      if (roll < 0.5) {
        play(time, Math.floor(rand() * count), random(0.25, 0.55), seconds);
      } else if (roll < 0.8) {
        play(time, Math.floor(random(0, count / 3)), random(0.25, 0.45), seconds);
        play(time + random(0, 0.04), Math.floor(random((2 * count) / 3, count)), random(0.2, 0.4), seconds);
      } else {
        const low = Math.floor(random(count / 4, (3 * count) / 4));
        for (let i = 0; i < 3; i++) play(time + i * 0.01, low + i, random(0.15, 0.3), seconds);
      }
    };

    // 次の出来事までの間。音は少しずつ増え、中ほどで最も多く、また減る
    const gapAfter = (progress: number) =>
      Math.min(16, random(3, 10) / (0.35 + 1.3 * Math.sin(Math.PI * Math.min(progress, 1))) / Math.sqrt(ctx.density()));

    const next = (time: number) => {
      const progress = elapsedOf(startAt, time) / silences.duration;
      if (progress >= 0.94) {
        // 最後の 1 音: 一番低い主音を、響きが消えるまで
        const lowestRoot = ctx.pitches().findIndex((p) => p.isRoot);
        play(time, Math.max(lowestRoot, 0), 0.35, 10);
        endAt = time + 11;
        return;
      }
      event(time);
      scheduled.push(transport.scheduleOnce(next, after(transport, gapAfter(progress))));
    };
    scheduled.push(transport.scheduleOnce(next, after(transport, 1.5)));

    let last = performance.now();
    return {
      // 沈黙のあいだに、クリックした高さの音を 1 つ置く
      pointer(_x, y, height) {
        if (endAt !== Infinity) return;
        play(Tone.now(), pitchIndexAt(y, height, ctx.pitches().length), 0.4, 8);
      },
      // 鳴った音を、時間を横軸にした楽譜のように残す（響きが消えても薄く残る）
      draw(g, width, height) {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        for (const m of marks) m.life = Math.max(0.2, m.life - dt / 8);

        const count = ctx.pitches().length;
        const span = width - MARGIN_LEFT - MARGIN_RIGHT;
        const progress = Math.min((Tone.now() - startAt) / silences.duration, 1);
        g.strokeStyle = "rgba(255, 255, 255, 0.08)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(MARGIN_LEFT + progress * span, 52);
        g.lineTo(MARGIN_LEFT + progress * span, height);
        g.stroke();

        for (const m of marks) {
          const x = MARGIN_LEFT + Math.min(m.at, 1) * span;
          const y = yOf(m.index, height, count);
          g.fillStyle = `hsla(45, 70%, 75%, ${m.life * (0.4 + m.velocity)})`;
          g.beginPath();
          g.arc(x, y, 2 + 6 * m.velocity, 0, Math.PI * 2);
          g.fill();
          if (m.life > 0.5) {
            g.strokeStyle = `hsla(45, 70%, 75%, ${(m.life - 0.5) * 0.6})`;
            g.beginPath();
            g.arc(x, y, 6 + (1 - m.life) * 60, 0, Math.PI * 2);
            g.stroke();
          }
        }
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        for (const id of scheduled) transport.clear(id);
        marks = [];
      },
    };
  },
};

// --- III. トッカータ ---

const MAX_MELODY = 24;
const TOCCATA_END = 0.9;

const toccata: Movement = {
  title: { ja: "III. トッカータ", en: "III. Toccata" },
  duration: 270,
  start(ctx) {
    const { transport, piano } = ctx;
    const startAt = Tone.now();
    let endAt = Infinity;

    // 旋律は画面の音高の番号で持つ。真ん中の狭い音域から始め、伸びるほど広い音域へ、終盤は上へ向かう
    const count = () => ctx.pitches().length;
    const centre = Math.floor(count() / 2);
    let melody = [centre];
    const nextNote = (progress: number) => {
      const from = melody[melody.length - 1];
      const reach = 2 + Math.floor(progress * 5); // 跳躍の大きさ
      const span = 2 + progress * count() * 0.6; // 中央からの広がり
      const climb = progress > 0.6 ? 0.65 : 0.5; // 終盤は上がりやすい
      for (;;) {
        const step = (1 + Math.floor(rand() * reach)) * (rand() < climb ? 1 : -1);
        const note = from + step;
        if (note >= 0 && note < count() && Math.abs(note - centre) <= span) return note;
      }
    };
    while (melody.length < 4) melody.push(nextNote(0));

    let window = 1; // 今の周で弾く音の数（1、1-2、1-2-3…と伸びる）
    let position = 0;
    let playing = -1;
    let glow: number[] = melody.map(() => 0);

    const finalStrike = (time: number) => {
      const pitches = ctx.pitches();
      const high = pitchAt(pitches, Math.max(...melody)).freq;
      const lowestRoot = pitches.findIndex((p) => p.isRoot);
      const low = pitchAt(pitches, Math.max(lowestRoot, 0)).freq;
      for (const freq of [high, high / 2, low, low / 2]) piano.triggerAttackRelease(freq, 5, time, 1);
      endAt = time + 6;
    };

    const loop = new Tone.Loop((time) => {
      if (endAt !== Infinity) return;
      const progress = elapsedOf(startAt, time) / toccata.duration;
      transport.bpm.value = ctx.bpm() * (0.85 + 0.35 * Math.min(progress, 1)); // 少しずつ加速する

      // 周の頭で、終わりに来ていれば最後の一撃で終える
      if (position === 0 && progress >= TOCCATA_END && window >= melody.length) {
        finalStrike(time);
        return;
      }

      const at = position;
      const pitches = ctx.pitches();
      // 偶数番目は右手、奇数番目は左手（1 オクターブ下）で交互に弾く
      const leftHand = at % 2 === 1;
      const freq = pitchAt(pitches, melody[at]).freq / (leftHand ? 2 : 1);
      const accent = at === 0 || at === window - 1;
      const velocity = Math.min(1, (0.35 + 0.5 * Math.min(progress, 1)) * (accent ? 1.25 : 1) * (leftHand ? 0.9 : 1));
      piano.triggerAttackRelease(freq, Tone.Time("16n").toSeconds() * 1.4, time + rand() * 0.005, velocity);
      Tone.getDraw().schedule(() => {
        playing = at;
        if (at < glow.length) glow[at] = accent ? 1 : 0.7;
      }, time);

      position++;
      if (position < window) return;
      // 1 周を弾き終えた。1 音伸ばし、旋律の終わりまで来たら旋律に 1 音足す。いっぱいなら、古い音を新しい音に置き換えて上へ進む
      position = 0;
      if (window < melody.length) window++;
      else if (melody.length < MAX_MELODY) {
        melody.push(nextNote(progress));
        glow.push(0);
        window = melody.length;
      } else {
        melody = [...melody.slice(1), nextNote(progress)];
        glow = [...glow.slice(1), 0];
      }
    }, "16n").start(after(transport, 0.05));

    let last = performance.now();
    return {
      // クリックした高さの音を、旋律の終わりに足す（いっぱいなら、最後の音を置き換える）
      pointer(_x, y, height) {
        if (endAt !== Infinity) return;
        const note = pitchIndexAt(y, height, count());
        if (melody.length < MAX_MELODY) {
          melody.push(note);
          glow.push(1);
        } else {
          melody[melody.length - 1] = note;
          glow[glow.length - 1] = 1;
        }
      },
      draw(g, width, height) {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        glow = glow.map((v) => Math.max(0, v - dt * 3));

        const step = (width - MARGIN_LEFT - MARGIN_RIGHT) / MAX_MELODY;
        const xOf = (i: number) => MARGIN_LEFT + (i + 0.5) * step;
        g.strokeStyle = "hsla(340, 40%, 60%, 0.25)";
        g.lineWidth = 1.5;
        g.beginPath();
        melody.forEach((note, i) => {
          const y = yOf(note, height, count());
          if (i === 0) g.moveTo(xOf(i), y);
          else g.lineTo(xOf(i), y);
        });
        g.stroke();
        melody.forEach((note, i) => {
          const inWindow = i < window;
          const hue = i % 2 === 1 ? 200 : 340; // 左手と右手
          const y = yOf(note, height, count());
          g.fillStyle = `hsla(${hue}, 80%, ${55 + 25 * glow[i]}%, ${inWindow ? 0.4 + 0.6 * glow[i] : 0.15})`;
          g.beginPath();
          g.arc(xOf(i), y, 3 + 5 * glow[i], 0, Math.PI * 2);
          g.fill();
          if (i === playing) {
            g.strokeStyle = `hsla(${hue}, 90%, 80%, 0.9)`;
            g.lineWidth = 2;
            g.beginPath();
            g.arc(xOf(i), y, 12, 0, Math.PI * 2);
            g.stroke();
          }
        });
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
      },
    };
  },
};

export const ichiyanagi: Sonata = {
  id: "ichiyanagi",
  composer: { ja: "一柳慧", en: "Toshi Ichiyanagi" },
  initials: "T.I.",
  // 調性に寄らない 12 音すべて
  scale: CHROMATIC,
  movements: [shifting, silences, toccata],
};

