import * as Tone from "tone";
import { pitchAt, pitchIndexAt } from "../scales";
import { t } from "../i18n";
import { after, DORIAN, MARGIN_LEFT, MARGIN_RIGHT, type Movement, rand, random, type Sonata, yOf } from "./movement";

// スティーヴ・ライヒがピアノソナタを書いたら、という試み。曲そのものは引用せず、作り方だけを借りている。
// I.  フェイズ: 両手が同じ 12 音の型を弾き、片方の手だけがほんの少し速くなって 1 音ずつ前へずれ、また重なる。12 回ずれると、元のそろった形に戻る。
//     ずれが 3 回進むごとに、型を音階の上でずらして和音を移し、そろうと最初の和音に帰る
// II. 脈動する和音: 和音を刻み続け、息の長さでふくらんでは消える。和音は少しずつ移り、最初の和音に帰る
// III. 積み上げ: 休符だった拍を 1 つずつ音に置き換えて型を作り、ずらした位置でもう一方の手が同じ型を積み上げる。最後は音を休符に戻していく

// 楽章の時間は、音の時計（AudioContext の時刻。Loop に渡される time と同じ）で測る
const elapsedOf = (startAt: number, time: number) => time - startAt;
const smoothstep = (x: number) => x * x * (3 - 2 * x);

// 画面の真ん中あたりから、隣り合ういくつかの音高を選ぶ（型の材料）
const middleNotes = (count: number, size: number) => {
  const from = Math.max(0, Math.floor(count / 2 - size / 2));
  return Array.from({ length: Math.min(size, count) }, (_, i) => from + i);
};

// --- I. フェイズ ---

const PATTERN_LENGTH = 12;
const PHASE_FROM = 0.06; // ここまでは両手がそろったまま
const PHASE_TO = 0.93; // ここで 12 回ずれ終え、そろった形に戻る
const HOLD = 0.6; // 1 回のずれのうち、止まって重なりを聞かせる割合（残りでなめらかにずれる）
const STAGES_PER_CHORD = 3; // ずれが 3 回進むごとに和音が変わる（12 回で 4 つの和音を巡り、そろうと最初の和音に帰る）

const phase: Movement = {
  title: { ja: "I. フェイズ", en: "I. Phase" },
  duration: 300,
  start(ctx) {
    const { transport, piano } = ctx;
    const startAt = Tone.now();
    let endAt = Infinity;

    // 5 つの音高で作る 12 音の型。前半と後半で同じ音を違う順に使う
    const notes = middleNotes(ctx.pitches().length, 5);
    const half = () => Array.from({ length: PATTERN_LENGTH / 2 }, (_, i) => notes[(i * 2 + Math.floor(rand() * 3)) % notes.length]);
    const pattern = [...half(), ...half()];
    const glow = { a: pattern.map(() => 0), b: pattern.map(() => 0) };

    // 左手（B）が右手（A）より何音ぶん前にいるか。止まる → なめらかにずれる、を 12 回繰り返す
    const stageOf = (progress: number) => Math.min(Math.max((progress - PHASE_FROM) / (PHASE_TO - PHASE_FROM), 0), 1) * PATTERN_LENGTH;
    const shiftAt = (progress: number) => {
      const x = stageOf(progress);
      const stage = Math.floor(x);
      if (stage >= PATTERN_LENGTH) return PATTERN_LENGTH;
      const within = x - stage;
      return stage + (within < HOLD ? 0 : smoothstep((within - HOLD) / (1 - HOLD)));
    };
    let shift = 0;

    // 和音の移り: 型の形はそのままに、音階の上で何段かずらす（音程の関係が変わり、和音の性格が変わる）。
    // 最初と最後（そろった形に戻ったとき）は、ずらさない
    const moves = [-3, -2, 2, 3, 4].sort(() => rand() - 0.5);
    const chords = [0, moves[0], moves[1], moves[2]];
    const chordOf = (progress: number) => {
      const stage = Math.floor(stageOf(progress));
      return stage >= PATTERN_LENGTH ? 0 : Math.floor(stage / STAGES_PER_CHORD);
    };
    let chord = 0;
    let transpose = 0;
    // 和音の低い音（型の一番低い音の 2 オクターブ下）を、和音が変わったときと 2 周ごとに長く置く
    const bass = (time: number, velocity: number) => {
      const freq = pitchAt(ctx.pitches(), Math.min(...pattern) + transpose).freq / 4;
      piano.triggerAttackRelease(freq, 4, time, velocity);
    };

    let step = 0; // 右手が弾いた音の数
    let bNext = 0; // 左手が次に弾く音の番号（ずれた分だけ右手より多く弾く）
    let playingA = -1;
    let playingB = -1;

    const strike = (index: number, time: number, velocity: number, octaveDown: boolean, glowOf: number[]) => {
      const at = index % PATTERN_LENGTH;
      const freq = pitchAt(ctx.pitches(), pattern[at] + transpose).freq / (octaveDown ? 2 : 1);
      piano.triggerAttackRelease(freq, Tone.Time("16n").toSeconds() * 1.5, time + rand() * 0.004, velocity);
      Tone.getDraw().schedule(() => {
        if (glowOf === glow.a) playingA = at;
        else playingB = at;
        glowOf[at] = 1;
      }, time);
    };

    const loop = new Tone.Loop((time) => {
      if (endAt !== Infinity) return;
      transport.bpm.value = ctx.bpm();
      const progress = elapsedOf(startAt, time) / phase.duration;
      shift = shiftAt(progress);
      // そろった形に戻ってしばらく弾いたら、型の頭で終える（余韻だけ残す）
      if (progress >= 0.97 && step % PATTERN_LENGTH === 0) {
        endAt = time + 3;
        return;
      }

      const sixteenth = Tone.Time("16n").toSeconds();
      const swell = 0.55 + 0.25 * Math.sin(Math.PI * Math.min(progress, 1));
      // 和音は、右手の型の頭で変える
      if (step % PATTERN_LENGTH === 0) {
        const next = chordOf(progress);
        if (next !== chord) {
          chord = next;
          transpose = chords[chord];
          bass(time, 0.35 * swell + 0.1);
        } else if (step % (PATTERN_LENGTH * 2) === 0 && progress >= PHASE_FROM / 2) bass(time, 0.2 * swell);
      }
      strike(step, time, swell * (step % 3 === 0 ? 1.15 : 1), false, glow.a);
      // 左手: 型の上の位置は bNext - shift。この刻みに入る音をすべて弾く（ずれている間は、ときどき 1 刻みに 2 音になる）
      if (progress >= PHASE_FROM / 2) {
        while (bNext - shift < step + 1) {
          const offset = Math.max(0, bNext - shift - step) * sixteenth;
          strike(bNext, time + offset, swell * 0.9 * (bNext % 3 === 0 ? 1.15 : 1), true, glow.b);
          bNext++;
        }
      } else bNext = step + 1;
      step++;
    }, "16n").start(after(transport, 0.05));

    let last = performance.now();
    return {
      // クリックした高さの音で、右手が次に弾く位置の音を置き換える（両手が同じ型なので、左手にも回ってくる）
      pointer(_x, y, height) {
        if (endAt !== Infinity) return;
        const at = step % PATTERN_LENGTH;
        pattern[at] = pitchIndexAt(y, height, ctx.pitches().length) - transpose;
        glow.a[at] = 1;
      },
      // 2 つの輪: 外が右手、内が左手。左手の輪は、ずれた分だけ回っている
      draw(g, width, height) {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        for (const list of [glow.a, glow.b]) for (let i = 0; i < list.length; i++) list[i] = Math.max(0, list[i] - dt * 3);

        const cx = (MARGIN_LEFT + width - MARGIN_RIGHT) / 2;
        const cy = height / 2 + 10;
        const radius = Math.min(width - MARGIN_LEFT - MARGIN_RIGHT, height - 120) * 0.38;
        const count = ctx.pitches().length;
        const ring = (r: number, rotate: number, hue: number, list: number[], playing: number) => {
          const angle = (i: number) => ((i - rotate) / PATTERN_LENGTH) * Math.PI * 2 - Math.PI / 2;
          g.strokeStyle = `hsla(${hue}, 40%, 60%, 0.18)`;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(cx, cy, r, 0, Math.PI * 2);
          g.stroke();
          pattern.forEach((note, i) => {
            // 音の高さは、輪からの張り出しで示す
            const reach = r + (((note + transpose) / Math.max(count - 1, 1)) - 0.5) * 40;
            const x = cx + Math.cos(angle(i)) * reach;
            const y = cy + Math.sin(angle(i)) * reach;
            g.fillStyle = `hsla(${hue}, 80%, ${55 + 25 * list[i]}%, ${0.35 + 0.65 * list[i]})`;
            g.beginPath();
            g.arc(x, y, 3 + 5 * list[i], 0, Math.PI * 2);
            g.fill();
            if (i === playing) {
              g.strokeStyle = `hsla(${hue}, 90%, 80%, 0.9)`;
              g.lineWidth = 2;
              g.beginPath();
              g.arc(x, y, 11, 0, Math.PI * 2);
              g.stroke();
            }
          });
        };
        ring(radius, 0, 28, glow.a, playingA);
        ring(radius * 0.62, -shift, 200, glow.b, playingB);

        g.font = "13px system-ui, sans-serif";
        g.textAlign = "center";
        g.fillStyle = "rgba(255, 255, 255, 0.5)";
        const label = shift >= PATTERN_LENGTH || shift === 0 ? t({ ja: "そろっている", en: "in unison" }) : `${Math.floor(shift)} / ${PATTERN_LENGTH}`;
        g.fillText(label, cx, cy - 4);
        g.fillStyle = "rgba(255, 255, 255, 0.35)";
        g.fillText(`${t({ ja: "和音", en: "chord" })} ${chord + 1} / ${chords.length}`, cx, cy + 16);
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
      },
    };
  },
};

// --- II. 脈動する和音 ---

type Chord = number[]; // 画面の音高の番号（低い順）

const pulses: Movement = {
  title: { ja: "II. 脈動する和音", en: "II. Pulsing chords" },
  duration: 240,
  start(ctx) {
    const { transport, piano } = ctx;
    const startAt = Tone.now();
    let endAt = Infinity;

    // 和音の巡り。主音の上に積んだ和音から始め、1 音ずつ動かして移り、最初の和音に帰る
    const count = ctx.pitches().length;
    const rootIndex = Math.max(0, ctx.pitches().findIndex((p, i) => p.isRoot && i >= count / 3));
    const first: Chord = [rootIndex, rootIndex + 2, rootIndex + 3, rootIndex + 5].map((i) => Math.min(i, count - 1));
    const chords: Chord[] = [first];
    const CHORDS = 9;
    while (chords.length < CHORDS - 1) {
      const chord = [...chords[chords.length - 1]];
      const at = Math.floor(rand() * chord.length);
      chord[at] = Math.min(Math.max(chord[at] + (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * 2)), 0), count - 1);
      chords.push([...new Set(chord)].sort((a, b) => a - b));
    }
    chords.push(first);
    const added: number[] = []; // クリックで今の和音に足した音

    // 1 つの和音は、息の長さ（ふくらんで消える）を 3 回。息の長さは少し揺らす
    const breaths = chords.flatMap((_, chord) => [0, 1, 2].map(() => ({ chord, length: random(0.85, 1.15) })));
    const total = breaths.reduce((sum, b) => sum + b.length, 0);
    let breath = 0;
    let breathStart = startAt;
    let level = 0; // 今の息の強さ（描画用）
    let pulse = 0;

    const breathSeconds = () => (pulses.duration / total) * breaths[Math.min(breath, breaths.length - 1)].length;

    const loop = new Tone.Loop((time) => {
      if (endAt !== Infinity) return;
      transport.bpm.value = ctx.bpm();
      let within = (time - breathStart) / breathSeconds();
      if (within >= 1) {
        breath++;
        breathStart = time;
        within = 0;
        if (breath >= breaths.length) {
          endAt = time + 2;
          return;
        }
        if (breaths[breath].chord !== breaths[breath - 1].chord) added.length = 0;
      }
      const progress = breath / breaths.length;
      const chord = chords[breaths[breath].chord];
      const pitches = ctx.pitches();
      // 息のふくらみ。曲の中ほどで最も強くなる
      const envelope = Math.sin(Math.PI * within) ** 1.5;
      const peak = 0.3 + 0.35 * Math.sin(Math.PI * progress);
      Tone.getDraw().schedule(() => (level = envelope), time);

      // 8 分の刻みで、和音を上下の 2 群に分けて交互に鳴らす（刻みが揺れて聞こえる）
      const notes = [...chord, ...added];
      const group = notes.filter((_, i) => i % 2 === pulse % 2);
      for (const index of group) piano.triggerAttackRelease(pitchAt(pitches, index).freq, 0.3, time + rand() * 0.006, 0.08 + peak * envelope);
      // 息の始まりに、低い音を長く置く
      if (within === 0 || pulse === 0) piano.triggerAttackRelease(pitchAt(pitches, Math.max(chord[0] - 5, 0)).freq / 2, breathSeconds(), time, 0.2 + peak * 0.4);
      pulse++;
    }, "8n").start(after(transport, 0.05));

    return {
      // クリックした高さの音を、今の和音に足す（次の和音に移るまで）
      pointer(_x, y, height) {
        if (endAt !== Infinity || added.length >= 3) return;
        added.push(pitchIndexAt(y, height, ctx.pitches().length));
      },
      draw(g, width, height) {
        const count = ctx.pitches().length;
        const current = Math.min(breath, breaths.length - 1);
        const chord = [...chords[breaths[current].chord], ...added];
        for (const index of chord) {
          const y = yOf(index, height, count);
          g.strokeStyle = `hsla(170, 60%, 65%, ${0.12 + 0.7 * level})`;
          g.lineWidth = 2 + 6 * level;
          g.beginPath();
          g.moveTo(MARGIN_LEFT, y);
          g.lineTo(width - MARGIN_RIGHT, y);
          g.stroke();
        }
        // 下に和音の巡り（今の和音を明るく）
        const step = (width - MARGIN_LEFT - MARGIN_RIGHT) / chords.length;
        chords.forEach((_, i) => {
          g.fillStyle = i === breaths[current].chord ? "rgba(255, 255, 255, 0.7)" : i < breaths[current].chord ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.1)";
          g.beginPath();
          g.arc(MARGIN_LEFT + (i + 0.5) * step, height - 70, 4, 0, Math.PI * 2);
          g.fill();
        });
      },
      finished: () => Tone.now() >= endAt,
      stop() {
        loop.dispose();
      },
    };
  },
};

// --- III. 積み上げ ---

type Voice = {
  offset: number; // 型をどれだけずらして弾くか（拍）
  octave: number; // 1 で 1 オクターブ上、-1 で下
  on: boolean[]; // 拍ごとに、音か休符か
  hue: number;
  glow: number[];
  enters: number; // 積み上げ始める位置
};

const SLOTS = 12;

const buildUp: Movement = {
  title: { ja: "III. 積み上げ", en: "III. Build-up" },
  duration: 270,
  start(ctx) {
    const { transport, piano } = ctx;
    const startAt = Tone.now();
    let endAt = Infinity;

    // 型の音高は 4 つの音から。休符を音に置き換える順番は、決まった順でなく偶然
    const notes = middleNotes(ctx.pitches().length, 4);
    const pattern = Array.from({ length: SLOTS }, () => notes[Math.floor(rand() * notes.length)]);
    const newVoice = (offset: number, octave: number, hue: number, enters: number): Voice => ({
      offset, octave, hue, enters, on: Array(SLOTS).fill(false), glow: Array(SLOTS).fill(0),
    });
    const voices = [
      newVoice(0, 0, 28, 0),
      newVoice(2 + Math.floor(rand() * 3) * 2 + 1, -1, 200, 0.22), // ずらし方は奇数拍（すき間に入り込む）
      newVoice(2 + Math.floor(rand() * 4) * 2, 1, 300, 0.45),
    ];
    voices[0].on[0] = true;

    // 声部ごとの、音にする拍の数の目標。入ってから満ちるまで積み、0.72 から後に入った声部から休符に戻す
    const target = (voice: Voice, index: number, progress: number) => {
      if (progress < voice.enters) return 0;
      const filled = Math.min(SLOTS, 1 + Math.floor(((progress - voice.enters) / 0.2) * SLOTS));
      const reduceFrom = 0.72 + (voices.length - 1 - index) * 0.07;
      if (progress < reduceFrom) return filled;
      const left = 1 - (progress - reduceFrom) / 0.1;
      return Math.max(index === 0 ? 1 : 0, Math.min(filled, Math.ceil(left * SLOTS)));
    };

    let slot = 0;
    let playing = -1;
    const loop = new Tone.Loop((time) => {
      if (endAt !== Infinity) return;
      transport.bpm.value = ctx.bpm();
      const progress = elapsedOf(startAt, time) / buildUp.duration;

      if (slot === 0) {
        // 周の頭で、1 拍ずつ足したり休符に戻したりする（1 周に 1 拍まで）
        voices.forEach((voice, index) => {
          const count = voice.on.filter(Boolean).length;
          const goal = target(voice, index, progress);
          if (count < goal) {
            const rests = voice.on.flatMap((on, i) => (on ? [] : [i]));
            voice.on[rests[Math.floor(rand() * rests.length)]] = true;
          } else if (count > goal) {
            const struck = voice.on.flatMap((on, i) => (on && !(index === 0 && i === 0) ? [i] : []));
            if (struck.length) voice.on[struck[Math.floor(rand() * struck.length)]] = false;
          }
        });
        // 最初の 1 音だけに戻ったら、終える。戻らないまま長引いたら、そこで終える
        const single = voices.every((v, i) => v.on.filter(Boolean).length === (i === 0 ? 1 : 0));
        if ((progress >= 0.95 && single) || progress > 1.15) {
          piano.triggerAttackRelease(pitchAt(ctx.pitches(), pattern[0]).freq, 3, time, 0.6);
          endAt = time + 3.5;
          return;
        }
      }

      const pitches = ctx.pitches();
      const dynamics = 0.45 + 0.4 * Math.sin(Math.PI * Math.min(progress, 1));
      voices.forEach((voice) => {
        // ずらした声部は、型の (slot - offset) 拍目を弾く
        const at = (slot - voice.offset + SLOTS) % SLOTS;
        if (!voice.on[at]) return;
        const freq = pitchAt(pitches, pattern[at]).freq * 2 ** voice.octave;
        const accent = at === 0 ? 1.2 : 1;
        piano.triggerAttackRelease(freq, Tone.Time("8n").toSeconds() * 0.9, time + rand() * 0.005, Math.min(1, dynamics * accent * (voice.octave === 1 ? 0.75 : 1)));
        Tone.getDraw().schedule(() => (voice.glow[at] = 1), time);
      });
      const current = slot;
      Tone.getDraw().schedule(() => (playing = current), time);
      slot = (slot + 1) % SLOTS;
    }, "8n").start(after(transport, 0.05));

    let last = performance.now();
    return {
      // クリックした高さの音を、次の拍に置く（休符なら音にする）
      pointer(_x, y, height) {
        if (endAt !== Infinity) return;
        pattern[slot] = pitchIndexAt(y, height, ctx.pitches().length);
        voices[0].on[slot] = true;
        voices[0].glow[slot] = 1;
      },
      // 12 拍を横に並べ、声部ごとに、ずらした位置で型を描く（休符は小さな点）
      draw(g, width, height) {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const count = ctx.pitches().length;
        const step = (width - MARGIN_LEFT - MARGIN_RIGHT) / SLOTS;
        const xOf = (i: number) => MARGIN_LEFT + (i + 0.5) * step;

        if (playing >= 0) {
          g.fillStyle = "rgba(255, 255, 255, 0.04)";
          g.fillRect(xOf(playing) - step / 2, 52, step, height - 52);
        }
        voices.forEach((voice, v) => {
          voice.glow = voice.glow.map((x) => Math.max(0, x - dt * 3));
          const shiftY = (v - 1) * 14; // 声部が重ならないよう、少し上下にずらす
          for (let i = 0; i < SLOTS; i++) {
            const at = (i - voice.offset + SLOTS) % SLOTS;
            const y = yOf(pattern[at], height, count) + shiftY;
            const glow = voice.glow[at];
            g.fillStyle = voice.on[at]
              ? `hsla(${voice.hue}, 80%, ${55 + 25 * glow}%, ${0.4 + 0.6 * glow})`
              : `hsla(${voice.hue}, 30%, 60%, 0.15)`;
            g.beginPath();
            g.arc(xOf(i), y, voice.on[at] ? 4 + 5 * glow : 2, 0, Math.PI * 2);
            g.fill();
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

export const reich: Sonata = {
  id: "reich",
  composer: { ja: "スティーヴ・ライヒ", en: "Steve Reich" },
  initials: "S.R.",
  // 長調とも短調ともつかない、教会旋法の響き
  scale: DORIAN,
  movements: [phase, pulses, buildUp],
};
