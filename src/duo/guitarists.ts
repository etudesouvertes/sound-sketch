import * as Tone from "tone";
import { t } from "../i18n";
import { pitchIndexAt, type Scale, SCALES } from "../scales";
import {
  AEOLIAN,
  clamp,
  DORIAN,
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
import { BOTH, chromaticAt, FIRST, fromLow, INFO_Y, legend, markView, noteName, type Owner, ownerColor, play, SECOND, type View, guideLeft } from "./common";

// 二人のギタリストが、2 台のピアノで連弾したら、という試み。ギターの弾き方をピアノに移している。
// ピアノ I（左）とピアノ II（右）を、それぞれ 1 人のギタリストが弾く。
// I.   噛み合わせ: 1 本の速い 16 分音符の線を、2 台で 1 音ずつ分け合って弾く（どちらか一方だけでは線にならない）。
//      線は、5 度を積んだギターの調弦（下から C G D A E G の 5 度の積み重ね）の弦をまたいで転がる形。拍子は 7/8・5/8・9/8 と移り、
//      2 周ごとに 1 音が隣の弦へ移り、1 つの音を相手に渡す。盛り上がりでは群の頭を 2 台で重ねる
// II.  伸びる音: ピアノ II は add9 の開いた和音をゆっくり分散して置き、高い 2 音を裏で鳴らす。
//      ピアノ I は長く伸ばすギターの音を、ピアノのトレモロ（主の音と 3 度下の音を細かく交互に）で弾き、長い音の旋律が昇ってまた降りる
// III. 掛け合い: 4/4 で、一方が弾くあいだ、もう一方が伴奏に回る。ピアノ I は 3 つ・5 つずつの群で上り下りする速い連なり、
//      ピアノ II は付点 8 分の間を空けた分散和音。伴奏は、ピアノ II が裏拍の短い和音（3 拍目にだけ低い音）、ピアノ I が 3+3+2 の 5 度。
//      受け渡しは 4 小節 → 2 → 1 → 半小節と短くなり、最後は 2 台が同じ型をユニゾンで弾いて、和音で終わる
//
// ギタリストらしさとして: ピアノ I は、長さの違う 2 本の線がずれていく位相（I の中ほど）と、全音音階で音階の外に出る連なり（III の半小節の受け渡し）。
// ピアノ II は、付点 8 分のこだま（ディレイ）と、8 分音符で回る add9 の分散和音（II の中ほど）
//
// 和音は楽章ごとに、主音から離れて戻る道筋を持つ（I は区切りごと、II は 8 拍ごと、III は受け渡しの段ごとに進み方が変わる）。
// 主音を低く保ったまま上の和音だけを動かす所と、低い音が 1 段ずつ上っていく所で、張りと戻りを作る
//
// 音階は E のエオリアン（自然短音階）。ギターの一番低い開放弦の E を主音に、短調の add9 の開いた響きが鳴るように。
// 和音の根音と形は、音階から決める（5 度が完全 5 度になる音だけを根音にし、9 度が短 9 度で濁るときは 4 度を使う）ので、
// 旋法を変えても破綻しない。旋法と主音は、設定で選べる（初めは E のエオリアン）

const PHRYGIAN: Scale = { id: "phrygian", group: "", name: { ja: "フリジア", en: "Phrygian" }, steps: [0, 1, 3, 5, 7, 8, 10] };
const MODES: Scale[] = [AEOLIAN, DORIAN, PHRYGIAN, SCALES.find((s) => s.id === "lydian")!];
// 今の旋法（設定で変わるので、毎回作品から読む）
const mode = () => twoGuitarists.scale;

// 度数（主音から数える。7 で 1 オクターブ上）の、主音からの半音の数（7 音の音階）
const semi = (d: number) => mode().steps[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
const perfectFifth = (root: number) => semi(root + 4) - semi(root) === 7;
// 和音の色の音: 根音の 2 度上が長 2 度なら 9 度（add9）、短 2 度なら濁るので 4 度（sus4）
const colorOf = (root: number) => (semi(root + 1) - semi(root) === 2 ? 1 : 3);
const isSus = (root: number) => colorOf(root) === 3;
// 開いた和音の形（根音からの度数）。add9 は根音・5 度・9 度・10 度、sus4 は根音・5 度・11 度・12 度
const voicingOf = (root: number) => (isSus(root) ? [0, 4, 10, 11] : [0, 4, 8, 9]);

// 和音: 根音と、一番下に置く音（主音を保ったまま上の和音だけ動かすときは、根音と違う）
type Chord = { root: number; bass: number };
// 度数の名前（エオリアンでの呼び方）。ほかの旋法で 5 度が減 5 度になる根音は、1 つ上（なければ 1 つ下）の度数に置き換える
const [i, III, iv, v, VI, VII] = [0, 2, 3, 4, 5, 6];
const fit = (d: number) => [d, d + 1, d - 1].map((x) => ((x % 7) + 7) % 7).find((x) => x === 0 || perfectFifth(x)) ?? 0;
const ch = (root: number, bass?: number): Chord => ({ root: fit(root), bass: bass ?? fit(root) });
// 一番下の音の、画面の一番下の主音から数えた位置（根音より上になるときは 1 オクターブ下げる）
const bassOf = (h: Layout, c: Chord) => fromLow(h, c.bass <= c.root ? c.bass : c.bass - 7);
// 和音の音（度数を 0〜6 に丸めたもの）。sus4 では 3 度を含めない
const tonesOf = (c: Chord) => [0, isSus(c.root) ? 3 : 2, 4, colorOf(c.root)].map((d) => (c.root + d) % 7);

// ピアノ II の音に、付点 8 分おきのこだま（ディレイ）を付けて鳴らす。repeats 回、少しずつ弱く
function echo(h: Layout, queue: Queue, view: View, index: number, time: number, velocity: number, seconds: number, delay: number, repeats = 2) {
  for (let k = 0; k <= repeats; k++) play(h, queue, view, SECOND, index, time + k * delay, velocity * 0.42 ** k, seconds);
}


function chordName(h: Layout, c: Chord): string {
  const letter = (degree: number) => noteName(h, fromLow(h, degree));
  const third = semi(c.root + 2) - semi(c.root);
  const name = `${letter(c.root)}${isSus(c.root) ? "sus4" : `${third === 3 ? "m" : ""}add9`}`;
  return c.bass === c.root ? name : `${name}/${letter(c.bass)}`;
}

// --- I. 噛み合わせ ---

// 拍子ごとの 16 分音符の数と、群（8 分音符 2 つか 3 つ）の分け方
const METERS = [
  { steps: 14, groups: [4, 4, 6], name: "7/8" },
  { steps: 14, groups: [4, 4, 6], name: "7/8" },
  { steps: 10, groups: [6, 4], name: "5/8" },
  { steps: 14, groups: [4, 6, 4], name: "7/8" },
  { steps: 18, groups: [4, 4, 4, 6], name: "9/8" },
  { steps: 10, groups: [4, 6], name: "5/8" },
  { steps: 14, groups: [4, 4, 6], name: "7/8" },
];
// 区切りごとの和音の進み。2 周ごとに次の和音へ移り（盛り上がりでは 1 周ごと）、区切りの中で繰り返す。
// 主音の上で始め、主音を保ったまま上だけ動き、離れて 5 度ずつ下がり、盛り上がりで低い音が上っていき、主音を保って戻る。
// 最後の区切りは繰り返さず、主音に着いたらそこに留まる
const planI = (): Chord[][] => [
  [ch(i)],
  [ch(i), ch(VI, i), ch(i), ch(VII, i)],
  pick([
    [ch(i), ch(VI), ch(VII), ch(iv)],
    [ch(i), ch(III), ch(VII), ch(iv)],
  ]),
  pick([
    [ch(iv), ch(VII), ch(III), ch(VI)],
    [ch(VI), ch(III), ch(VII), ch(iv)],
  ]),
  [ch(iv), ch(v), ch(VI), ch(VII)],
  [ch(iv, i), ch(i), ch(VI, i), ch(VII, i)],
  [ch(VI), ch(VII), ch(i)],
];
const CLIMAX_I = 4; // 群の頭を 2 台で重ね、和音が 1 周ごとに変わる区切り
// 2 台が別々の線を弾く区切り。ピアノ II の線はピアノ I より 16 分音符 1 つ長く、1 周ごとにずれていく。
// 盛り上がりの区切りで、また 1 本の線を分け合う形に噛み合い直す
const PHASE_I = new Set([2, 3]);
// 線が転がる弦。5 度を積んだギターの調弦（5 度の積み重ね）にならい、根音・5 度・オクターブ・9 度（か 4 度）・12 度・15 度と開いて積む
// （音階によっては 5 度を積み続けると減 5 度に当たるので、積むのは根音の 5 度まで）。一番下の弦はピアノ II の低い音に使い、線は上の 5 本を転がる
const stringsOf = (root: number) => [0, 4, 7, colorOf(root) + 7, 11, 14];

// 群ごとに、2 本上の弦へ跳んで 1 本戻る、を繰り返して弦をまたいで転がる。ときどき上下を逆にする
function rollLine(groups: number[]): number[] {
  return groups.flatMap((size) => {
    const from = pick([0, 0, 1]);
    const cell = Array.from({ length: size }, (_, i) => from + Math.floor(i / 2) + (i % 2) * 2);
    const folded = cell.map((s) => (s > 4 ? 8 - s : s));
    return rand() < 0.3 ? folded.map((s) => 4 - s) : folded;
  });
}

// 線のどの音をどちらが弾くか。alt は 1 音ずつ交互。groups は群ごとに頭を交互に受け持ち、残りは交互に分けて、ところどころ入れ替える。
// heads は groups と同じで、群の頭だけを 2 台で重ねる
function splitLine(groups: number[], style: "alt" | "groups" | "heads"): Owner[] {
  if (style === "alt") return groups.flatMap((size) => Array.from({ length: size }, (_, i) => (i % 2 === 0 ? FIRST : SECOND)));
  let head: Owner = FIRST;
  return groups.flatMap((size) => {
    const owners: Owner[] = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? head : head === FIRST ? SECOND : FIRST));
    // 6 音の群では、頭のあとの 1 組を入れ替えて、2 音続けて同じ台が弾く所を作る
    if (size >= 6 && rand() < 0.6) [owners[2], owners[3]] = [owners[3], owners[2]];
    if (style === "heads") owners[0] = BOTH;
    head = head === FIRST ? SECOND : FIRST;
    return owners;
  });
}

const interlock: Movement = {
  title: { ja: "I. 噛み合わせ", en: "I. Interlock" },
  duration: 270,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const sixteenth = () => 15 / ctx.bpm();

    const plan = planI();
    let section = 0;
    let line: number[] = [];
    let owners: Owner[] = [];
    let heads = new Set<number>();
    let fixed: (number | null)[] = []; // クリックで置いた音（その区切りのあいだ、線の音の代わりに弾く）
    let step = 0;
    let lineB: number[] = []; // ずれていく区切りの、ピアノ II の線
    let headsB = new Set<number>();
    let stepB = 0;
    let cycle = 0;
    let sectionAt = 0;
    let stepAt = startAt + 0.4;
    let ending = false;
    const shown = timed({ section: 0, step: 0, stepB: 0, solo: true, chord: plan[0][0] });
    // 今の和音: 2 周ごと（盛り上がりでは 1 周ごと）に進む。最後の区切りでは、最後の和音に着いたら留まる
    const rate = () => (section === CLIMAX_I ? 1 : 2);
    const chordNow = () => {
      const chords = plan[section];
      const at = Math.floor(cycle / rate());
      return chords[section === plan.length - 1 ? Math.min(at, chords.length - 1) : at % chords.length];
    };

    const beginSection = (i: number, at: number) => {
      section = i;
      const meter = METERS[i];
      line = rollLine(meter.groups);
      owners = splitLine(meter.groups, i === 0 || i === METERS.length - 1 ? "alt" : i === CLIMAX_I ? "heads" : "groups");
      heads = new Set(meter.groups.map((_, g) => meter.groups.slice(0, g).reduce((a, b) => a + b, 0)));
      fixed = line.map(() => null);
      const groupsB = [...meter.groups.slice(0, -1), meter.groups.at(-1)! + 1];
      lineB = rollLine(groupsB);
      headsB = new Set(groupsB.map((_, g) => groupsB.slice(0, g).reduce((a, b) => a + b, 0)));
      stepB = 0;
      step = 0;
      cycle = 0;
      sectionAt = at;
    };
    beginSection(0, stepAt);
    const sectionSeconds = () => interlock.duration / METERS.length;

    // 2 周ごとに、線の 1 音を隣の弦へ移し、多く弾いている台の 1 音（群の頭でない所）を相手に渡す
    const mutate = () => {
      const i = Math.floor(rand() * line.length);
      if (fixed[i] === null) line[i] = clamp(line[i] + pick([-1, 1]), 0, 4);
      const firsts = owners.filter((o) => o === FIRST).length;
      const seconds = owners.filter((o) => o === SECOND).length;
      const from: Owner = firsts > seconds ? FIRST : seconds > firsts ? SECOND : pick([FIRST, SECOND]);
      const candidates = owners.flatMap((o, j) => (o === from && !heads.has(j) ? [j] : []));
      if (candidates.length) owners[pick(candidates)] = from === FIRST ? SECOND : FIRST;
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      while (!ending && stepAt < time + TICK) {
        const h = layout(ctx);
        const meter = METERS[section];
        const s = sixteenth();
        const progress = (stepAt - startAt) / interlock.duration;
        const chord = chordNow();
        const root = chord.root;
        const strings = stringsOf(root).map((d) => fromLow(h, root + d));
        // 最初の 2 周はピアノ I だけで線を聞かせ、そこからピアノ II が半分を引き取る
        const solo = section === 0 && cycle < 2;
        const phase = PHASE_I.has(section);
        const owner = solo || phase ? FIRST : owners[step];
        const index = fixed[step] ?? strings[1 + line[step]];
        const level = 0.2 + 0.16 * Math.sin(Math.PI * clamp(progress, 0, 1));
        const velocity = level * (heads.has(step) ? 1.3 : 1) * random(0.93, 1.05) * (phase ? 0.8 : 1);
        if (owner !== SECOND) play(h, queue, view, FIRST, index, stepAt, velocity, s * 1.6);
        // ずれていく区切りでは、ピアノ II も自分の線を休まず弾く（群の頭を強く）
        if (phase) {
          play(h, queue, view, SECOND, strings[1 + lineB[stepB]], stepAt, level * 0.8 * (headsB.has(stepB) ? 1.3 : 1) * random(0.93, 1.05), s * 1.6);
          stepB = (stepB + 1) % lineB.length;
        }
        // 重ねるときは、ピアノ II が 1 オクターブ下で
        if (owner === SECOND) play(h, queue, view, SECOND, index, stepAt, velocity, s * 1.6);
        if (owner === BOTH) play(h, queue, view, SECOND, index - h.perOctave, stepAt, velocity * 0.9, s * 1.6);
        // 和音が変わるたびに、ピアノ II が一番下の音を長く置く
        if (step === 0 && cycle % rate() === 0 && !solo) play(h, queue, view, SECOND, bassOf(h, chord), stepAt, level * 0.9, s * meter.steps * rate());
        shown.set(stepAt, { section, step, stepB, solo, chord });
        stepAt += s;
        step++;
        if (step < meter.steps) continue;
        step = 0;
        cycle++;
        if (cycle >= 2 && cycle % 2 === 0) mutate();
        if (phase && cycle % 2 === 0) {
          const k = Math.floor(rand() * lineB.length);
          lineB[k] = clamp(lineB[k] + pick([-1, 1]), 0, 4);
        }
        if (stepAt - sectionAt < sectionSeconds()) continue;
        if (section + 1 < METERS.length) {
          beginSection(section + 1, stepAt);
          continue;
        }
        // 終わり: 6 本の弦を 2 台で分けて、一度に鳴らす
        ending = true;
        const last = stringsOf(0).map((d) => fromLow(h, d));
        last.slice(3).forEach((i) => play(h, queue, view, FIRST, i, stepAt, 0.32, 5));
        last.slice(0, 3).forEach((i) => play(h, queue, view, SECOND, i, stepAt, 0.32, 5));
        play(h, queue, view, SECOND, last[0] - h.perOctave, stepAt, 0.3, 5.5);
        endAt = stepAt + 6;
      }
    });

    return {
      // クリックした高さの音を、次に弾く位置に置く（この区切りのあいだ、そこではその音を弾く）
      pointer(_x, y, height) {
        if (ending) return;
        fixed[step] = pitchIndexAt(y, height, ctx.pitches().length);
      },
      draw(g, width, height) {
        const guideBottom = PHASE_I.has(shown.get().section) ? INFO_Y + 16 : INFO_Y + 12; // 案内の下端（音部記号と重なるかを見るため）
        view.draw(g, width, height);
        legend(g, guideBottom);
        // 1 周の 16 分音符を箱で並べ、弾く台の色で塗る（2 台で重ねる所は白）。群の切れ目は少し空ける。
        // ずれていく区切りでは、2 台の線を 2 段に並べる（下の段のピアノ II は 1 つ長い）
        const now = shown.get();
        const meter = METERS[now.section];
        const phase = PHASE_I.has(now.section);
        const row = (groups: number[], y: number, colour: (at: number) => Owner, current: number) => {
          let x = guideLeft(g, guideBottom);
          let at = 0;
          for (const size of groups) {
            for (let i = 0; i < size; i++, at++) {
              g.fillStyle = ownerColor(colour(at), at === current ? 0.95 : 0.3);
              g.fillRect(x, y, 10, phase ? 7 : 12);
              x += 12;
            }
            x += 6;
          }
          return x;
        };
        let x = row(meter.groups, INFO_Y, (at) => (now.solo || phase ? FIRST : (owners[at] ?? FIRST)), now.step);
        if (phase) x = Math.max(x, row([...meter.groups.slice(0, -1), meter.groups.at(-1)! + 1], INFO_Y + 9, () => SECOND, now.stepB));
        g.font = "11px system-ui, sans-serif";
        g.textAlign = "left";
        g.fillStyle = "rgba(255, 255, 255, 0.55)";
        g.fillText(meter.name, x + 4, INFO_Y + 10);
        g.fillStyle = "rgba(255, 255, 255, 0.7)";
        g.fillText(chordName(layout(ctx), now.chord), x + 4 + g.measureText(meter.name).width + 12, INFO_Y + 10);
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

// --- II. 伸びる音 ---

// 和音の進み（1 つ 8 拍）。A: 主音と VI の揺り返し → B: 主音から離れて巡る → C: 低い音が 1 段ずつ上り、旋律の頂点で VII に着く
// → A': 主音を低く保ったまま、上の和音だけが VI・iv・VII と動いて、主音に戻る
const planII = (): Chord[] => [
  ch(i), ch(VI), ch(i), ch(VI),
  ...pick([
    [ch(iv), ch(VII), ch(III), ch(VI)],
    [ch(III), ch(VII), ch(iv), ch(VI)],
  ]),
  ch(iv), ch(v), ch(VI), ch(VII),
  ch(i), ch(VI, i), ch(iv, i), ch(VII, i),
  ch(i),
];
const CHORD_BEATS = 8;
// ピアノ II が、ゆっくり置く和音から、8 分音符で休まず回る分散和音（こだま付き）に変わる和音（B と C）
const ARPEGGIO_II = (chord: number) => chord >= 4 && chord < 12;
const ARPEGGIO = [0, 1, 2, 1, 3, 1, 2, 1]; // 開いた和音の音の順（根音・5 度・9 度・5 度・10 度…）
const TREMOLO = 1 / 9; // トレモロの 1 打の間（秒）

const sustain: Movement = {
  title: { ja: "II. 伸びる音", en: "II. Sustain" },
  duration: 195,
  start(ctx) {
    const startAt = Tone.now();
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    // 1 拍の長さ。テンポの設定の 0.4 倍の遅さで、?short のときは楽章の長さに合わせて縮める
    const beat = () => (60 / (ctx.bpm() * 0.4)) * (sustain.duration / 195);

    const chords = planII();
    const chordStarts: number[] = []; // 和音ごとの始まりの時刻（旋律の音が、そのとき鳴っている和音を知るため）
    let chord = 0;
    let chordAt = startAt + 0.4;

    // ピアノ I の旋律: 今の音と、次の音を始める時刻
    let melody = -1;
    let noteAt = Infinity;
    let ending = false;
    const shownChord = timed(0);

    // 長い音を 1 つ、トレモロで弾く。音量は、ふくらんでから少しずつ引く
    const hold = (h: Layout, index: number, at: number, seconds: number, peak: number) => {
      const lower = index - h.degree(2);
      for (let k = 0, time = at; time < at + seconds; k++, time += TREMOLO) {
        const x = (time - at) / seconds;
        const envelope = x < 0.3 ? 0.4 + 0.6 * (x / 0.3) : 1 - 0.55 * ((x - 0.3) / 0.7);
        const main = k % 2 === 0;
        play(h, queue, view, FIRST, main ? index : lower, time + rand() * 0.008, peak * envelope * (main ? 1 : 0.6), TREMOLO * 2.5);
      }
    };

    // 旋律の次の音: 曲の 3 分の 2 ほどで一番高くなる弧に向かって、1〜2 段ずつ動く。そのとき鳴っている和音の音を選びやすい
    const nextNote = (h: Layout, progress: number, at: number) => {
      const arc = progress < 0.65 ? progress / 0.65 : Math.max(0, (1 - progress) / 0.35);
      const target = h.centre + Math.round(1 + 8 * arc);
      const sounding = chords[Math.max(0, chordStarts.filter((start) => start <= at + 0.01).length - 1)];
      const tones = tonesOf(sounding);
      const cost = (n: number) => Math.abs(n - target) + rand() * 1.5 + (tones.includes((((n - h.lowRoot) % 7) + 7) % 7) ? 0 : 1.2);
      const choices = melody < 0 ? [-1, 0, 1].map((d) => target + d) : [-2, -1, 1, 2].map((d) => melody + d);
      return choices.reduce((best, c) => (cost(c) < cost(best) ? c : best), choices[0]);
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      const h = layout(ctx);
      const b = beat();
      // ピアノ II: 和音の頭で開いた和音を下から分散して置き、高い 2 音を裏で鳴らす
      while (!ending && chordAt < time + TICK) {
        const progress = (chordAt - startAt) / sustain.duration;
        const current = chords[chord];
        const root = current.root;
        const last = chord === chords.length - 1;
        const length = b * CHORD_BEATS * (last ? 1.5 : 1);
        const voices = voicingOf(root).map((d) => fromLow(h, root + d));
        const level = 0.22 + 0.12 * Math.sin(Math.PI * clamp(progress, 0, 1));
        chordStarts.push(chordAt);
        // 主音を保つ和音では、その下に低い主音を先に置く
        if (current.bass !== root) play(h, queue, view, SECOND, bassOf(h, current), chordAt, level * 1.1, length);
        if (ARPEGGIO_II(chord)) {
          // 根音を長く置き、その上で 8 分音符の分散和音を回す。付点 8 分のこだまが、8 分の間に入り込む
          const eighth = 30 / ctx.bpm();
          play(h, queue, view, SECOND, voices[0], chordAt, level * 1.1, length);
          for (let k = 1, at = chordAt + eighth; at < chordAt + length - eighth / 2; k++, at += eighth) {
            const swell = Math.min(1, (at - chordAt) / (b * 2) + (chord > 4 ? 1 : 0));
            echo(h, queue, view, voices[ARPEGGIO[k % ARPEGGIO.length]] + (k % 8 === 4 ? h.perOctave : 0), at, level * 0.55 * (0.5 + 0.5 * swell), eighth * 1.5, eighth * 1.5, 1);
          }
        } else voices.forEach((v, k) => play(h, queue, view, SECOND, v, chordAt + (k + (current.bass !== root ? 1 : 0)) * 0.11, level * (k === 0 ? 1.1 : 1), length));
        if (!last && !ARPEGGIO_II(chord)) {
          const upper = voices.slice(2).map((v) => v + h.perOctave);
          for (const at of [2.5, 6]) {
            if (rand() < 0.75) upper.forEach((v) => echo(h, queue, view, v, chordAt + at * b, level * 0.5, b * 2.5, 45 / ctx.bpm()));
          }
        }
        shownChord.set(chordAt, chord);
        // ピアノ I は 2 つめの和音から入る
        if (chord === 2) noteAt = chordAt;
        if (last) {
          // 終わり: ピアノ I は主音の和音の色の音（9 度か 4 度）を伸ばして消える
          ending = true;
          hold(h, h.centre + h.degree(colorOf(0)), chordAt + b, length - b, 0.2);
          endAt = chordAt + length + 2;
        }
        chordAt += length;
        chord++;
      }
      // ピアノ I: 3〜6 拍の長い音。ときどき前の音から短く滑り込み（音階を 2 つ 3 つ駆ける）、ときどき 1 拍休む
      while (!ending && noteAt < time + TICK) {
        const progress = (noteAt - startAt) / sustain.duration;
        const next = nextNote(h, progress, noteAt);
        if (melody >= 0 && Math.abs(next - melody) >= 2 && rand() < 0.4) {
          const dir = Math.sign(next - melody);
          for (let k = 1; k < Math.abs(next - melody); k++) play(h, queue, view, FIRST, melody + dir * k, noteAt - 0.07 * (Math.abs(next - melody) - k), 0.14, 0.12);
        }
        melody = next;
        const beats = pick([3, 4, 4, 5, 6]);
        hold(h, melody, noteAt, beats * b, 0.16 + 0.16 * Math.sin(Math.PI * clamp(progress, 0, 1)));
        noteAt += (beats + (rand() < 0.3 ? 1 : 0)) * b;
      }
    });

    return {
      // クリックした高さの音を、ピアノ II が高い所で柔らかく鳴らす
      pointer(_x, y, height) {
        if (ending) return;
        const h = layout(ctx);
        play(h, queue, view, SECOND, pitchIndexAt(y, height, h.count), Tone.now() + 0.02, 0.18, 2.5);
      },
      draw(g, width, height) {
        const guideBottom = INFO_Y + 16; // 案内の下端（音部記号と重なるかを見るため）
        view.draw(g, width, height);
        legend(g, guideBottom);
        // 今の和音と、次の和音の名前
        const h = layout(ctx);
        const i = shownChord.get();
        const next = chords[i + 1];
        g.font = "13px system-ui, sans-serif";
        g.textAlign = "left";
        g.fillStyle = "rgba(255, 255, 255, 0.7)";
        const current = chordName(h, chords[i]);
        g.fillText(current, guideLeft(g, guideBottom), INFO_Y + 12);
        if (next !== undefined) {
          g.fillStyle = "rgba(255, 255, 255, 0.3)";
          g.fillText(`→ ${chordName(h, next)}`, guideLeft(g, guideBottom) + g.measureText(current).width + 10, INFO_Y + 12);
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

// --- III. 掛け合い ---

type Turn = { who: Owner | -1; bars: number; stage: number }; // -1 は前奏（ピアノ II の伴奏だけ）、BOTH はユニゾン。stage は和音の進みの段
const TRADES = [
  [4, 8],
  [2, 12],
  [1, 12],
  [0.5, 12],
]; // 受け渡しの長さ（小節）と回数
const UNISON_BARS = 8;
// 段ごとの和音の進み（1 小節に 1 つ）。受け渡しが短くなるほど、和音も主音から離れて速く巡る:
// 前奏と 4 小節: 主音と VI の揺り返し → 2 小節: i–VI–VII–iv → 1 小節: 5 度ずつ下がる → 半小節: 低い音が上っていく
// → ユニゾン: VI–VII から主音へ、を 2 回
const stagesIII = (): Chord[][] => [
  [ch(i), ch(i), ch(VI), ch(VI)],
  [ch(i), ch(VI), ch(VII), ch(iv)],
  [ch(iv), ch(VII), ch(III), ch(VI)],
  [ch(iv), ch(v), ch(VI), ch(VII)],
  [ch(VI), ch(VII), ch(i), ch(i)],
];
const SKANK = [2, 6, 10, 14]; // ピアノ II の伴奏: 8 分の裏拍（16 分音符の位置）
const FIFTHS_COMP = [0, 6, 12]; // ピアノ I の伴奏: 3+3+2
const DOTTED = [
  [0, 3, 6, 8, 11, 14],
  [0, 3, 6, 10, 12],
  [2, 5, 8, 12, 14],
]; // ピアノ II の付点 8 分の間の型（1 小節の 16 分音符の位置）

// ピアノ I の連なり: 3 つ（後の方では 5 つも）ずつの群を、群ごとに 1 段ずつずらして上り下りする。length は 16 分音符の数
function groupRun(h: Layout, length: number, from: number, late: boolean): number[] {
  const cells = [[0, 1, 2], [0, 2, 1], ...(late ? [[0, 1, 2, 1, 3]] : [])];
  const notes: number[] = [];
  let at = from;
  let dir = rand() < 0.5 ? 1 : -1;
  while (notes.length < length) {
    const cell = pick(cells);
    notes.push(...cell.map((d) => at + d * dir));
    at += dir;
    if (at > h.centre + 9) dir = -1;
    if (at < h.centre - 2) dir = 1;
  }
  return notes.slice(0, length);
}

// ピアノ I の全音音階の連なり: 3 つずつの群を、群ごとに全音ずつずらして上り下りする（音階の外の音も弾く）
function wholeToneRun(h: Layout, length: number, from: number): { index: number; cents: number }[] {
  const semis: number[] = [];
  let at = 0;
  let dir = rand() < 0.5 ? 1 : -1;
  while (semis.length < length) {
    semis.push(at, at + 2 * dir, at + 4 * dir);
    at += 2 * dir;
    if (at > 8) dir = -1;
    if (at < -6) dir = 1;
  }
  return semis.slice(0, length).map((n) => chromaticAt(h, from, n));
}
const WHOLE_TONE_STAGE = 3; // 全音音階になる段（半小節の受け渡し）

const trading: Movement = {
  title: { ja: "III. 掛け合い", en: "III. Trading" },
  duration: 160,
  start(ctx) {
    let endAt = Infinity;
    const queue = pendingQueue(ctx);
    const view = markView(ctx);
    const sixteenth = () => 15 / ctx.bpm();

    // 受け渡しの順。?short のときは回数を減らす
    const scale = trading.duration / 160;
    const turns: Turn[] = [{ who: -1, bars: 2, stage: 0 }];
    let who: Owner = FIRST;
    TRADES.forEach(([bars, count], stage) => {
      for (let k = 0; k < Math.max(2, Math.round(count * scale)); k++) {
        turns.push({ who, bars, stage });
        who = who === FIRST ? SECOND : FIRST;
      }
    });
    const STAGES_III = stagesIII();
    turns.push({ who: BOTH, bars: Math.max(2, Math.round(UNISON_BARS * scale)), stage: STAGES_III.length - 1 });
    const tradeTurns = turns.length - 2;
    // 段ごとの始まりの小節
    const stageStart: number[] = [];
    turns.reduce((bar, turn) => {
      stageStart[turn.stage] ??= Math.floor(bar);
      return bar + turn.bars;
    }, 0);
    const chordOfBar = (bar: number): Chord => {
      const stage = stageStart.filter((start) => start <= bar).length - 1; // 段は小節の順に並ぶ
      const chords = STAGES_III[Math.max(0, stage)];
      return chords[(bar - stageStart[Math.max(0, stage)]) % chords.length];
    };
    const shownBar = timed(0);

    let turn = 0;
    let within = 0; // 受け渡しの中の 16 分音符の位置
    let total = 0; // 曲の頭からの 16 分音符の数（小節と伴奏の位置）
    let stepAt = Tone.now() + 0.4;
    let phrase = new Map<number, number[]>(); // 受け渡しの中の位置 → 弾く音
    let bends = new Map<number, number>(); // 受け渡しの中の位置 → 音階の外へのずれ（セント）
    let riff: number[] = [];
    let lastRun = -1;
    let ending = false;
    const shownTurn = timed(0);

    // 受け渡しの頭で、弾く人の句を作る
    const makePhrase = (h: Layout, current: Turn) => {
      phrase = new Map();
      bends = new Map();
      const length = current.bars * 16;
      if (current.who === FIRST && current.stage === WHOLE_TONE_STAGE) {
        // 和音が上っていく段では、全音音階で和音から外れて張りを作る（ユニゾンで音階に戻る）
        const run = wholeToneRun(h, length - 2, lastRun >= 0 ? lastRun : h.centre + 2);
        run.forEach((n, k) => {
          phrase.set(k, [n.index]);
          bends.set(k, n.cents);
        });
        lastRun = run.at(-1)!.index;
      } else if (current.who === FIRST) {
        // 終わりの 2 つは空け、最後の音は長めに
        const run = groupRun(h, length - 2, lastRun >= 0 ? lastRun : h.centre + 2, turn > tradeTurns / 2);
        run.forEach((n, i) => phrase.set(i, [n]));
        lastRun = run.at(-1)!;
      } else if (current.who === SECOND) {
        // 小節ごとに付点 8 分の型を選び、和音の上の方の音を順に上り下りする。小節の頭は 2 音を重ねる
        let tone = Math.floor(rand() * 3);
        for (let bar = 0; bar < current.bars; bar++) {
          const root = chordOfBar(Math.floor((total + bar * 16) / 16)).root;
          const tones = [7, 11, colorOf(root) + 14, 16, 18].map((d) => fromLow(h, root + d));
          for (const pos of pick(DOTTED)) {
            if (bar * 16 + pos >= length) break;
            tone = clamp(tone + pick([-1, 1, 1]), 0, tones.length - 1);
            phrase.set(bar * 16 + pos, pos === 0 && tone > 0 ? [tones[tone - 1], tones[tone]] : [tones[tone]]);
          }
        }
      } else if (current.who === BOTH) {
        // 2 小節の型（ピアノ I の連なりから）を、2 台で繰り返す
        if (riff.length === 0) riff = groupRun(h, 32, h.centre + 1, true);
        for (let i = 0; i < length; i++) phrase.set(i, [riff[i % riff.length]]);
      }
    };

    const loop = scheduler(ctx, (time) => {
      queue.flush(time);
      while (!ending && stepAt < time + TICK) {
        const h = layout(ctx);
        const s = sixteenth();
        const current = turns[turn];
        if (within === 0) {
          makePhrase(h, current);
          shownTurn.set(stepAt, turn);
        }
        const chord = chordOfBar(Math.floor(total / 16));
        const root = chord.root;
        const pos = total % 16;
        if (pos === 0) shownBar.set(stepAt, Math.floor(total / 16));
        const level = 0.22 + 0.14 * (turn / turns.length);
        // 伴奏: ピアノ I が弾くあいだ（と前奏）はピアノ II の裏拍の和音、ピアノ II が弾くあいだはピアノ I の 5 度
        if (current.who === FIRST || current.who === -1) {
          if (SKANK.includes(pos)) for (const d of [7, 9, 11]) play(h, queue, view, SECOND, fromLow(h, root + d), stepAt, level * 0.7, 0.09);
          if (pos === 8) play(h, queue, view, SECOND, bassOf(h, chord), stepAt, level * 1.1, s * 6);
        } else if (current.who === SECOND && FIFTHS_COMP.includes(pos)) {
          for (const d of [4, colorOf(root) + 7]) play(h, queue, view, FIRST, fromLow(h, root + d), stepAt, level * 0.65, s * 1.5);
        }
        const notes = phrase.get(within);
        if (notes) {
          if (current.who === FIRST) {
            const last = within === current.bars * 16 - 3;
            for (const n of notes) play(h, queue, view, FIRST, n, stepAt, level * (within % 3 === 0 ? 1.2 : 1) * random(0.93, 1.05), last ? s * 4 : s * 1.4, bends.get(within) ?? 0);
          } else if (current.who === SECOND) {
            for (const n of notes) echo(h, queue, view, n, stepAt, level * 1.05, 0.45, s * 3);
          } else if (current.who === BOTH) {
            const swell = 0.32 + 0.18 * (within / (current.bars * 16));
            const accent = within % 3 === 0 ? 1.15 : 1;
            for (const n of notes) {
              play(h, queue, view, FIRST, n, stepAt, swell * accent, s * 1.4);
              play(h, queue, view, SECOND, n - h.perOctave, stepAt, swell * accent * 0.9, s * 1.4);
            }
          }
        }
        stepAt += s;
        total++;
        within++;
        if (within < current.bars * 16) continue;
        within = 0;
        turn++;
        if (turn < turns.length) continue;
        // 終わり: 次の小節の頭で、ピアノ I は 5 度の積み重ね、ピアノ II は開いた和音と低い主音
        ending = true;
        for (const d of [7, 11, colorOf(0) + 14]) play(h, queue, view, FIRST, fromLow(h, d), stepAt, 0.45, 4);
        for (const d of voicingOf(0)) play(h, queue, view, SECOND, fromLow(h, d), stepAt, 0.45, 4);
        play(h, queue, view, SECOND, fromLow(h, 0) - h.perOctave, stepAt, 0.4, 4.5);
        endAt = stepAt + 5;
      }
    });

    return {
      // クリックした高さの音を、今弾いている人が短く鳴らす（前奏ではピアノ II）
      pointer(_x, y, height) {
        if (ending) return;
        const h = layout(ctx);
        const current = turns[turn]?.who ?? SECOND;
        const piano = current === FIRST ? FIRST : SECOND;
        play(h, queue, view, piano, pitchIndexAt(y, height, h.count), Tone.now() + 0.02, 0.3, 0.25);
      },
      draw(g, width, height) {
        const guideBottom = INFO_Y + 34; // 案内の下端（音部記号と重なるかを見るため）
        view.draw(g, width, height);
        legend(g, guideBottom);
        // 受け渡しを、長さに比例した帯で並べる（今のものを明るく。前奏は灰色、ユニゾンは白）
        const now = shownTurn.get();
        let x = guideLeft(g, guideBottom);
        for (let i = Math.max(0, now - 3); i < turns.length && x < width - 40; i++) {
          const turnWidth = Math.max(6, turns[i].bars * 14);
          const who = turns[i].who;
          const alpha = i === now ? 0.95 : i < now ? 0.15 : 0.35;
          g.fillStyle = who === -1 ? `rgba(160, 160, 160, ${alpha})` : ownerColor(who, alpha);
          g.fillRect(x, INFO_Y, turnWidth, 12);
          x += turnWidth + 3;
        }
        // 今の小節の和音
        g.font = "13px system-ui, sans-serif";
        g.textAlign = "left";
        g.fillStyle = "rgba(255, 255, 255, 0.7)";
        g.fillText(chordName(layout(ctx), chordOfBar(shownBar.get())), guideLeft(g, guideBottom), INFO_Y + 30);
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

export const twoGuitarists: Sonata = {
  // 今は 2 人の名を出さず、「二人のギタリストが連弾したら」とだけ言う（コードの中の名前は、作るときの手がかり）
  id: "guitarists",
  composer: { ja: "二人のギタリスト", en: "Two Guitarists" },
  credit: { ja: "二人のギタリストが連弾したら", en: "as if two guitarists played it" },
  initials: "Gt. & Gt.",
  scale: AEOLIAN,
  root: "E", // ギターの一番低い開放弦
  modes: MODES,
  tuning: "loose", // 2 台のピアノは、ぴったりはそろわない（台ごとに違うずれ方をする）
  movements: [interlock, sustain, trading],
};
