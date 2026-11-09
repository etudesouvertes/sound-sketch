import * as Tone from "tone";
import "../ripples/style.css";
import { drawPitchGuides, pitchAt, pitchIndexAt } from "../scales";
import { steppedRamp } from "../audio";
import { setupCanvas, setupGenerativePage } from "../generative";

// 置いた音が、それぞれ少しずつ違う周期でループする。
// 周期のわずかな差で音どうしの重なり方がゆっくりずれていく（スティーヴ・ライヒのフェイジング）。

type Seed = {
  x: number;
  y: number;
  basePeriod: number; // 置いたときの横位置（と天気）で決まる単音モードの周期 (秒)
  plays: number;
  hue: number;
  loop: Tone.Loop;
};
type Bloom = { x: number; y: number; life: number; hue: number; strength: number };

const CENTER_PERIOD = 2.3; // 画面中央の周期 (秒)
const HALF_RANGE = 0.3; // 標準では左端 2.0 秒〜右端 2.6 秒
const MAX_SEEDS = 16;
const FADE_PLAYS = 16; // 減衰オンのとき、何回鳴ったら消えるか
const IDLE_BEFORE_AUTO = 8; // 操作がない状態が何秒続いたら自動で置き始めるか
const AUTO_INTERVAL = 3;
const RING_RADIUS = 14;

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const fadeEl = document.querySelector<HTMLInputElement>("#fade")!;
const modeEl = document.querySelector<HTMLSelectElement>("#mode")!;
const phraseLengthEl = document.querySelector<HTMLSelectElement>("#phrase-length")!;
const phraseNewEl = document.querySelector<HTMLButtonElement>("#phrase-new")!;
const phraseTempoEl = document.querySelector<HTMLInputElement>("#phrase-tempo")!;
const phraseTempoValueEl = document.querySelector<HTMLOutputElement>("#phrase-tempo-value")!;
const autoEl = document.querySelector<HTMLInputElement>("#auto")!;
const clearEl = document.querySelector<HTMLButtonElement>("#clear")!;

// --- 音 ---

const reverb = new Tone.Reverb({ decay: 8, wet: 0.5 }).toDestination();
const synth = new Tone.PolySynth(Tone.FMSynth, {
  harmonicity: 2,
  modulationIndex: 2.5,
  envelope: { attack: 0.01, decay: 2, sustain: 0, release: 2 },
  modulationEnvelope: { attack: 0.01, decay: 0.8, sustain: 0, release: 1 },
}).connect(reverb);
synth.maxPolyphony = 64; // フレーズモードでは 1 周に複数の音が重なる
synth.volume.value = -16;
const rampBrightness = steppedRamp(2.5, (modulationIndex) => synth.set({ modulationIndex }));

// 種は縦位置だけを持ち、鳴るたびに今のスケールで音を決める。
// そのためスケールを変えると、置いてある種もその場で新しいスケールの音に置き換わる。
// 天気: 空模様で音色の明るさと響きの長さ、気温で周期の長さ、風で周期の幅（ずれの速さ）、雨で自動の頻度、雲でリバーブが変わる。
// 周期はこれから置く種から変わり、置いてある種はそのまま。
// 変化: 天気で決まった値を中心に、音域・密度・FM の明るさ・リバーブが経過時間でゆっくり揺れ、
// 20 分ごとに 5 度上へ転調する。音域と転調は置いてある種にも効く
// （音を先に作っておく。applyParams は音を参照する）
const page = setupGenerativePage({
  defaults: { scale: "major-pentatonic", root: "D" },
  // ▶ で、自動で置くのをすぐ始める
  onPlay: () => {
    idle = IDLE_BEFORE_AUTO;
    untilAuto = 0;
  },
  reverb: { node: reverb, wet: 0.25, decay: 8 },
  applyParams: (params) => {
    rampBrightness(2.5 * 2 ** (params.drift.brightness + params.mood.brightness), params.ramp);
    synth.set({ envelope: { decay: 2 * params.mood.sustain, release: 2 * params.mood.sustain } });
  },
});
const { transport } = page;

// --- 種 ---

let width = 0;
let height = 0;
const g = setupCanvas(canvas, (w, h) => {
  width = w;
  height = h;
});
let seeds: Seed[] = [];
let blooms: Bloom[] = [];

// degree はフレーズ内の音の、出だしからのスケール上の度数
function pitchOf(seed: Seed, degree = 0) {
  const pitches = page.pitches();
  return pitchAt(pitches, pitchIndexAt(seed.y, height, pitches.length) + degree);
}

// --- フレーズ ---

// すべての種が同じフレーズを鳴らす（ライヒ『Piano Phase』のように、同じフレーズが周期の差でずれていく）。
// 出だしは種の高さの音で、そこから 0〜5 度上の音を、直前と同じ音にならないように選ぶ
let phrase: number[] = [];

function generatePhrase() {
  const length = Number(phraseLengthEl.value);
  phrase = [0];
  while (phrase.length < length) {
    const next = Math.floor(Math.random() * 6);
    if (next !== phrase[phrase.length - 1]) phrase.push(next);
  }
  retime();
}

function updatePhraseControls() {
  const off = modeEl.value !== "phrase";
  phraseLengthEl.disabled = off;
  phraseNewEl.disabled = off;
  phraseTempoEl.disabled = off;
  retime();
}

// フレーズモードでは 1 周 = 音数 × 1 音の間隔（テンポで決まる）。
// 横位置による周期の差（中央との比）はそのまま掛けて、フェイジングのずれを保つ
function periodOf(seed: Seed): number {
  if (modeEl.value !== "phrase") return seed.basePeriod;
  const noteInterval = 60 / Number(phraseTempoEl.value);
  return (seed.basePeriod / CENTER_PERIOD) * phrase.length * noteInterval;
}

// モード・音数・テンポが変わったら、置いてある種のループの長さも合わせる
function retime() {
  for (const s of seeds) s.loop.interval = periodOf(s);
}

modeEl.addEventListener("change", updatePhraseControls);
phraseLengthEl.addEventListener("change", generatePhrase);
phraseNewEl.addEventListener("click", generatePhrase);
phraseTempoEl.addEventListener("input", () => {
  phraseTempoValueEl.value = phraseTempoEl.value;
  retime();
});
phraseTempoValueEl.value = phraseTempoEl.value;
generatePhrase();
updatePhraseControls();

function periodAt(x: number): number {
  const m = page.mood();
  const halfRange = HALF_RANGE * (0.5 + 1.5 * m.spread);
  return (CENTER_PERIOD + (x / width * 2 - 1) * halfRange) / m.speed;
}

function removeSeed(seed: Seed) {
  seed.loop.dispose();
  seeds = seeds.filter((s) => s !== seed);
}

function plant(x: number, y: number) {
  const seed: Seed = {
    x,
    y,
    basePeriod: periodAt(x),
    plays: 0,
    hue: 160 + (x / width) * 140,
    loop: undefined!,
  };
  seed.loop = new Tone.Loop((time) => {
    const strength = fadeEl.checked ? 1 - seed.plays / FADE_PLAYS : 1;
    if (strength <= 0) {
      Tone.getDraw().schedule(() => removeSeed(seed), time);
      return;
    }
    // 周を数えるのは減衰がオンのあいだだけ。あとからオンにしても、そこから少しずつ弱くなる
    if (fadeEl.checked) seed.plays++;
    // 単音モードは 1 周に 1 音。フレーズモードは 1 周の中にフレーズの音を均等に並べる
    const degrees = modeEl.value === "phrase" ? phrase : [0];
    const step = periodOf(seed) / degrees.length;
    degrees.forEach((degree, i) => {
      const at = time + i * step;
      const velocity = (0.3 + 0.7 * strength) * (i === 0 ? 1 : 0.75);
      synth.triggerAttackRelease(pitchOf(seed, degree).freq, "16n", at, velocity);
      const bloomStrength = i === 0 ? strength : strength * 0.4;
      Tone.getDraw().schedule(
        () => blooms.push({ x: seed.x, y: seed.y, life: 1, hue: seed.hue, strength: bloomStrength }),
        at,
      );
    });
  }, periodOf(seed)).start(transport.seconds);

  seeds.push(seed);
  if (seeds.length > MAX_SEEDS) removeSeed(seeds[0]);
}

function draw() {
  g.fillStyle = "rgba(27, 29, 35, 0.25)";
  g.fillRect(0, 0, width, height);
  drawPitchGuides(g, width, height, page.pitches());

  for (const b of blooms) {
    const r = RING_RADIUS + (1 - b.life) * (60 + 80 * b.strength);
    g.strokeStyle = `hsla(${b.hue}, 80%, 70%, ${b.life * (0.3 + 0.7 * b.strength)})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(b.x, b.y, r, 0, Math.PI * 2);
    g.stroke();
  }

  for (const s of seeds) {
    const phase = s.loop.progress;
    const alpha = fadeEl.checked ? Math.max(0.15, 1 - s.plays / FADE_PLAYS) : 1;

    g.strokeStyle = `hsla(${s.hue}, 30%, 60%, ${alpha * 0.4})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(s.x, s.y, RING_RADIUS, 0, Math.PI * 2);
    g.stroke();

    // 12 時の位置から時計回りに、ループの進み具合を描く
    g.strokeStyle = `hsla(${s.hue}, 80%, 70%, ${alpha})`;
    g.beginPath();
    g.arc(s.x, s.y, RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + phase * Math.PI * 2);
    g.stroke();

    g.fillStyle = `hsla(${s.hue}, 80%, 80%, ${alpha})`;
    g.beginPath();
    g.arc(s.x, s.y, 3, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = `hsla(${s.hue}, 20%, 70%, ${alpha * 0.6})`;
    g.font = "11px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText(`${pitchOf(s).label}  ${periodOf(s).toFixed(2)}s`, s.x, s.y + RING_RADIUS + 16);
  }
}

// --- 画面とループ ---

let last = performance.now();
let idle = 0;
let untilAuto = 0;

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  idle += dt;
  if (page.playing() && autoEl.checked && idle >= IDLE_BEFORE_AUTO) {
    untilAuto -= dt;
    if (untilAuto <= 0) {
      plant(Math.random() * width, height * (0.15 + Math.random() * 0.7));
      untilAuto = (AUTO_INTERVAL / page.autoDensity()) * (0.5 + Math.random());
    }
  }

  for (const b of blooms) b.life -= dt * 0.6;
  blooms = blooms.filter((b) => b.life > 0);

  draw();
  requestAnimationFrame(frame);
}

canvas.addEventListener("pointerdown", async (e) => {
  await page.ensureStarted();
  idle = 0;
  plant(e.clientX, e.clientY);
});

clearEl.addEventListener("click", () => {
  for (const s of [...seeds]) removeSeed(s);
  blooms = [];
});

requestAnimationFrame(frame);
