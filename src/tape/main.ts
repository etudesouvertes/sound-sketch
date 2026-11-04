import * as Tone from "tone";
import "../ripples/style.css";
import { drawPitchGuides, pitchAt, pitchIndexAt, type Pitch } from "../scales";
import { setupCanvas, setupGenerativePage } from "../generative";
import { tk } from "../i18n";

// 1 本のテープに録った音が、再生ヘッドから録音ヘッドへ戻されて何度も録り重ねられる
// （ブライアン・イーノ『Discreet Music』、ロバート・フリップとイーノの 2 台のテープレコーダーの仕組み）。
// 戻るたびに少し小さく、こもっていくので、古い層ほど遠くに聞こえる。
// 画面は流れるテープで、右の録音ヘッドで録られた音が左へ流れ、左の再生ヘッドで鳴って、また右から（薄くなって）出てくる

// 弾いた 1 音。テープに録られた音はスケールを変えても変わらないので、周波数で持つ。
// 位置はテープが進んだ周の数（tapeAt）で持つ。1 周の長さを変えても、テープの上の位置は変わらない
type Mark = {
  freq: number;
  start: number; // 録り始めたときのテープの位置 (周)
  end: number | null; // 押している間は null
  level: number; // 今の周の大きさ（1 = 弾いたとき）
  turns: number; // level に反映した周の数
};
type Glow = { y: number; life: number; strength: number };
// 押している指（マウス）ごとに、今鳴らしている音
type Touch = { index: number; freq: number; mark: Mark };

const LOOP_LOWPASS = 3200; // 1 周ごとに高い音を削る (Hz)
const LOOP_HIGHPASS = 90; // 1 周ごとに低い音を削る (Hz)。低音がたまって濁らないように
// 1 周の長さを変えるときに移す時間 (秒)。スライダーの動きにすぐ付いていくよう短くする。
// 長さが変わる間は、ヘッドを動かしたのと同じで、速く動かすほど音程が大きくうねる（長くすると下がり、短くすると上がる）
const LENGTH_RAMP = 0.08;
const MAX_SATURATION = 16; // 歪み 100% で、戻す音を飽和させる前に何倍にするか
const SILENT_LEVEL = 0.02; // これより小さくなった音は画面から消す
const PLAY_HEAD = 0.18; // 再生ヘッドの横位置（画面の幅に対する割合）
const REC_HEAD = 0.82; // 録音ヘッドの横位置

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const clearEl = document.querySelector<HTMLButtonElement>("#clear")!;
const lengthEl = document.querySelector<HTMLInputElement>("#tape-length")!;
const lengthValueEl = document.querySelector<HTMLOutputElement>("#tape-length-value")!;
const feedbackEl = document.querySelector<HTMLInputElement>("#tape-feedback")!;
const feedbackValueEl = document.querySelector<HTMLOutputElement>("#tape-feedback-value")!;
const saturationEl = document.querySelector<HTMLInputElement>("#tape-saturation")!;
const saturationValueEl = document.querySelector<HTMLOutputElement>("#tape-saturation-value")!;
const timbreEl = document.querySelector<HTMLSelectElement>("#timbre")!;

const loopSeconds = () => Number(lengthEl.value);
const feedbackAmount = () => Number(feedbackEl.value) / 100;

// --- 音 ---

// 弾いた音（その場で聞こえる音）と、テープから戻ってきた音は、同じリバーブへ送る
const reverb = new Tone.Reverb({ decay: 6, wet: 0.35 }).toDestination();

// テープ: 録音ヘッド → (1 周の秒数) → 再生ヘッド。再生した音は削ってから録音ヘッドへ戻す。
// 戻す音は飽和させ、重ねすぎても大きくなり続けないようにする。「歪み」では、飽和させる前に大きくして後で同じだけ戻す。
// 小さい音の残り方は変わらず、層が厚くなるほど早く、強く歪む
const recordIn = new Tone.Gain(1);
const tapeDelay = new Tone.Delay({ delayTime: loopSeconds(), maxDelay: 30 });
const loopLowpass = new Tone.Filter({ type: "lowpass", frequency: LOOP_LOWPASS, Q: 0.5 });
const loopHighpass = new Tone.Filter({ type: "highpass", frequency: LOOP_HIGHPASS, Q: 0.5 });
const saturateIn = new Tone.Gain(1);
const saturate = new Tone.WaveShaper((x) => Math.tanh(x), 4096);
const saturateOut = new Tone.Gain(1);
const feedback = new Tone.Gain(feedbackAmount());
const tapeOut = new Tone.Gain(1).connect(reverb);
recordIn.connect(tapeDelay);
tapeDelay.chain(loopLowpass, loopHighpass, saturateIn, saturate, saturateOut);
saturateOut.connect(feedback);
feedback.connect(tapeDelay);
saturateOut.connect(tapeOut);

// 倍音の多い、少しずらした 2 本のノコギリ波。弾いた瞬間は明るく、すぐ落ち着く。
// テープを回るたびに高い倍音から削られていくので、層の新しさが音色でも分かる
const synth = new Tone.PolySynth(Tone.MonoSynth, {
  oscillator: { type: "fatsawtooth", count: 2, spread: 12 },
  filter: { type: "lowpass", Q: 1, rolloff: -24 },
  filterEnvelope: { attack: 0.005, decay: 0.8, sustain: 0.45, release: 1.5, baseFrequency: 350, octaves: 3.5 },
  envelope: { attack: 0.005, decay: 1.2, sustain: 0.35, release: 1.8 },
});
synth.maxPolyphony = 16;
synth.volume.value = -20;

// 音色の「ドライブ」: 歪ませてからギターアンプのスピーカーのように高音を丸め、長く伸ばす（フリップの歪んだギターのように）。
// クリーンと切り替えられるよう、両方の道を作っておき、大きさで選ぶ
const clean = new Tone.Gain(1);
const distortion = new Tone.Distortion({ distortion: 0.8, oversample: "4x" });
const drive = new Tone.Gain(0);
const cabinet = new Tone.Filter({ type: "lowpass", frequency: 18000, Q: 0.7 });
synth.fan(clean, distortion);
distortion.connect(drive);
clean.connect(cabinet);
drive.connect(cabinet);
cabinet.connect(reverb);
cabinet.connect(recordIn);

const DRIVE_LEVEL = 0.12; // 歪ませると大きくなるので、クリーンと同じくらいに揃える
function applyTimbre() {
  const driven = timbreEl.value === "drive";
  clean.gain.rampTo(driven ? 0 : 1, 0.05);
  drive.gain.rampTo(driven ? DRIVE_LEVEL : 0, 0.05);
  cabinet.frequency.rampTo(driven ? 3800 : 18000, 0.05);
  synth.set({ envelope: driven ? { sustain: 0.6, release: 2.5 } : { sustain: 0.35, release: 1.8 } });
}
timbreEl.addEventListener("change", applyTimbre);
applyTimbre();

// 天気: 空模様でテープが削る高さ（晴れで明るく、雨でこもる）、雲でリバーブが変わる。
// 変化: 天気で決まった値を中心に、音域・テープの明るさ・リバーブがゆっくり揺れ、20 分ごとに 5 度上へ転調する
let lowpass = LOOP_LOWPASS;
const page = setupGenerativePage({
  defaults: { scale: "major-pentatonic", root: "A" },
  reverb: { node: reverb, wet: 0.35, decay: 6 },
  applyParams: (params) => {
    lowpass = LOOP_LOWPASS * 2 ** (params.drift.brightness + params.mood.brightness);
    loopLowpass.frequency.rampTo(lowpass, params.ramp);
  },
});

// 1 周で残る大きさ。戻す量と、テープが削る高さ・低さ（2 次のフィルターの、基音での減り方）で決まる
function turnLoss(freq: number): number {
  const low = 1 / Math.sqrt(1 + (freq / lowpass) ** 4);
  const high = 1 / Math.sqrt(1 + (LOOP_HIGHPASS / freq) ** 4);
  return feedback.gain.value * low * high;
}

// --- テープの位置 ---

// テープが進んだ周の数。1 周の長さを変えたときは、そこからの進み方だけを変える
let clock = { time: 0, turns: 0, seconds: loopSeconds() };
const tapeAt = (time: number) => clock.turns + (time - clock.time) / clock.seconds;

const showLength = () => (lengthValueEl.value = `${loopSeconds().toFixed(2)} s`);
lengthEl.addEventListener("input", () => {
  showLength();
  const now = Tone.immediate();
  clock = { time: now, turns: tapeAt(now), seconds: loopSeconds() };
  tapeDelay.delayTime.rampTo(loopSeconds(), LENGTH_RAMP, now);
});
showLength();

let clearing = false;
feedbackEl.addEventListener("input", () => {
  feedbackValueEl.value = `${feedbackEl.value}%`;
  if (!clearing) feedback.gain.rampTo(feedbackAmount(), 0.1);
});
feedbackValueEl.value = `${feedbackEl.value}%`;

function applySaturation() {
  saturationValueEl.value = `${saturationEl.value}%`;
  const k = MAX_SATURATION ** (Number(saturationEl.value) / 100);
  saturateIn.gain.rampTo(k, 0.1);
  saturateOut.gain.rampTo(1 / k, 0.1);
}
saturationEl.addEventListener("input", applySaturation);
applySaturation();

// --- 演奏 ---

let width = 0;
let height = 0;
const g = setupCanvas(canvas, (w, h) => {
  width = w;
  height = h;
});
let marks: Mark[] = [];
let glows: Glow[] = [];
const touches = new Map<number, Touch>();

const playX = () => width * PLAY_HEAD;
const recX = () => width * REC_HEAD;

// 周波数の縦位置。今のスケールの音高の間を、対数で補う（スケールを変えたあとの、音階から外れた音も描ける）
function yOf(freq: number, pitches: Pitch[]): number {
  const band = height / pitches.length;
  let i = 0;
  while (i < pitches.length - 2 && pitches[i + 1].freq < freq) i++;
  const lo = pitches[i].freq;
  const hi = pitches[i + 1].freq;
  const index = i + Math.log(freq / lo) / Math.log(hi / lo);
  return height - (index + 0.5) * band;
}

function noteOn(pointerId: number, y: number) {
  const pitches = page.pitches();
  const index = pitchIndexAt(y, height, pitches.length);
  const { freq } = pitchAt(pitches, index);
  const now = Tone.immediate();
  synth.triggerAttack(freq, now, 0.8);
  const mark: Mark = { freq, start: tapeAt(now), end: null, level: 1, turns: 0 };
  marks.push(mark);
  touches.set(pointerId, { index, freq, mark });
}

function noteOff(pointerId: number) {
  const touch = touches.get(pointerId);
  if (!touch) return;
  const now = Tone.immediate();
  synth.triggerRelease(touch.freq, now);
  touch.mark.end = tapeAt(now);
  touches.delete(pointerId);
}

canvas.addEventListener("pointerdown", async (e) => {
  canvas.setPointerCapture(e.pointerId);
  await page.ensureStarted();
  if (!page.started()) return;
  noteOn(e.pointerId, e.clientY);
});

// なぞって別の音高の帯に入ったら、前の音を離して次の音を弾く。同じ帯の中にいる間は、音を伸ばしたまま
canvas.addEventListener("pointermove", (e) => {
  const touch = touches.get(e.pointerId);
  if (!touch) return;
  if (pitchIndexAt(e.clientY, height, page.pitches().length) === touch.index) return;
  noteOff(e.pointerId);
  noteOn(e.pointerId, e.clientY);
});

for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, (e) => noteOff((e as PointerEvent).pointerId));
}

// テープを消す。戻す量と再生を 1 周より少し長く絞り、テープに残った音を流しきってから戻す
let clearTimer: ReturnType<typeof setTimeout> | undefined;
clearEl.addEventListener("click", () => {
  clearTimeout(clearTimer);
  clearing = true;
  const now = Tone.immediate();
  feedback.gain.cancelScheduledValues(now).setTargetAtTime(0, now, 0.05);
  tapeOut.gain.cancelScheduledValues(now).setTargetAtTime(0, now, 0.05);
  marks = marks.filter((m) => m.end === null);
  // 押している音は、ここから録り直す
  for (const m of marks) Object.assign(m, { start: tapeAt(now), level: 1, turns: 0 });
  glows = [];
  clearTimer = setTimeout(() => {
    clearing = false;
    const t = Tone.immediate();
    feedback.gain.setTargetAtTime(feedbackAmount(), t, 0.05);
    tapeOut.gain.setTargetAtTime(1, t, 0.05);
  }, (loopSeconds() + LENGTH_RAMP + 0.3) * 1000);
});

// --- 画面 ---

// 録った音は、録音ヘッドから再生ヘッドへ 1 周かけて流れ、また録音ヘッドから出てくる。
// u はテープの上の位置（0 = 録音ヘッド、1 = 再生ヘッド）
const xAt = (u: number) => recX() - u * (recX() - playX());

function drawMark(m: Mark, tape: number, pitches: Pitch[]) {
  const age = tape - m.start;
  if (age < 0) return;
  const y = yOf(m.freq, pitches);
  const head = age % 1; // 音の頭の位置
  const length = Math.min((m.end ?? tape) - m.start, 1);
  const tail = head - length; // 音の終わりの位置。負なら、前の周の分が再生ヘッドの手前に残っている
  const alpha = Math.min(1, m.level) * 0.9;

  g.strokeStyle = `hsla(200, 85%, 72%, ${alpha})`;
  g.lineWidth = 3;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(xAt(head), y);
  g.lineTo(xAt(Math.max(tail, 0)), y);
  if (tail < 0) {
    g.moveTo(xAt(1), y);
    g.lineTo(xAt(1 + tail), y);
  }
  g.stroke();

  g.fillStyle = `hsla(200, 90%, 82%, ${alpha})`;
  g.beginPath();
  g.arc(xAt(head), y, 3.5, 0, Math.PI * 2);
  g.fill();
}

function drawHead(x: number, label: string) {
  g.strokeStyle = "rgba(232, 232, 236, 0.35)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, height);
  g.stroke();
  g.fillStyle = "rgba(232, 232, 236, 0.5)";
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(label, x, height - 36);
}

function draw(tape: number) {
  g.fillStyle = "#1b1d23";
  g.fillRect(0, 0, width, height);
  const pitches = page.pitches();
  drawPitchGuides(g, width, height, pitches);

  // テープの帯（2 つのヘッドの間が、ちょうど 1 周分）
  g.fillStyle = "rgba(255, 255, 255, 0.025)";
  g.fillRect(playX(), 0, recX() - playX(), height);

  for (const glow of glows) {
    g.strokeStyle = `hsla(200, 85%, 72%, ${glow.life * glow.strength * 0.8})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(playX(), glow.y, 6 + (1 - glow.life) * 40, 0, Math.PI * 2);
    g.stroke();
  }

  for (const m of marks) drawMark(m, tape, pitches);
  drawHead(playX(), tk("tape.playHead"));
  drawHead(recX(), tk("tape.recHead"));
}

let last = performance.now();

function frame(t: number) {
  const dt = Math.min((t - last) / 1000, 0.05);
  last = t;
  const tape = tapeAt(Tone.immediate());
  const pitches = page.pitches();

  // 再生ヘッドを過ぎた音は、1 周分小さくなって録音ヘッドから出てくる
  for (const m of marks) {
    const turns = Math.floor(tape - m.start);
    if (turns <= m.turns) continue;
    glows.push({ y: yOf(m.freq, pitches), life: 1, strength: Math.min(1, m.level) });
    m.level *= turnLoss(m.freq) ** (turns - m.turns);
    m.turns = turns;
  }
  marks = marks.filter((m) => m.level >= SILENT_LEVEL);

  for (const glow of glows) glow.life -= dt * 1.2;
  glows = glows.filter((glow) => glow.life > 0);

  draw(tape);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
