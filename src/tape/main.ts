import * as Tone from "tone";
import "../ripples/style.css";
import { drawPitchGuides, pitchAt, pitchIndexAt, type Pitch } from "../scales";
import { setupCanvas, setupGenerativePage } from "../generative";
import { tk } from "../i18n";

// 1 本のテープに録った音が、再生ヘッドから録音ヘッドへ戻されて何度も録り重ねられる
// （ブライアン・イーノ『Discreet Music』、ロバート・フリップとイーノの 2 台のテープレコーダーの仕組み）。
// 戻るたびに少し小さく、こもっていくので、古い層ほど遠くに聞こえる。
// 画面は流れるテープで、右の録音ヘッドで録られた音が左へ流れ、左の再生ヘッドで鳴って、また右から（薄くなって）出てくる。
// 録音ヘッドの右は演奏中に触る操作盤で、残り方のフェーダーと、ソロ・ホールド・フェードのボタンを置く

// 弾いた 1 音。テープに録られた音はスケールを変えても変わらないので、周波数で持つ。
// 位置はテープが進んだ周の数（tapeAt）で持つ。1 周の長さを変えても、テープの上の位置は変わらない
type Mark = {
  freq: number;
  start: number; // 録り始めたときのテープの位置 (周)
  end: number | null; // 押している間は null
  level: number; // 今の周の大きさ（1 = 弾いたとき）
  turns: number; // level に反映した周の数
};
type Glow = { x: number; y: number; life: number; strength: number };
// 押している指（マウス）ごとに、今鳴らしている音。テープに録っていない（ソロなど）ときは mark が null
type Touch = { index: number; freq: number; mark: Mark | null };
type Button = "solo" | "hold" | "fade";

const LOOP_LOWPASS = 3200; // 1 周ごとに高い音を削る (Hz)
const LOOP_HIGHPASS = 90; // 1 周ごとに低い音を削る (Hz)。低音がたまって濁らないように
// 1 周の長さを変えるときに移す時間 (秒)。スライダーの動きにすぐ付いていくよう短くする。
// 長さが変わる間は、ヘッドを動かしたのと同じで、速く動かすほど音程が大きくうねる（長くすると下がり、短くすると上がる）
const LENGTH_RAMP = 0.08;
const MAX_SATURATION = 16; // 歪み 100% で、戻す音を飽和させる前に何倍にするか
const MAX_FEEDBACK = 98; // 残り方の上限 (%)。100% はホールドだけ
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
const fadeLengthEl = document.querySelector<HTMLInputElement>("#fade-length")!;
const fadeLengthValueEl = document.querySelector<HTMLOutputElement>("#fade-length-value")!;
const timbreEl = document.querySelector<HTMLSelectElement>("#timbre")!;

const loopSeconds = () => Number(lengthEl.value);
const feedbackAmount = () => Number(feedbackEl.value) / 100;

// --- 演奏の状態 ---

// ソロ: 弾いた音を聞かせるだけで、テープには録らない（ボタンで切り替えるか、Shift を押している間）。
// ホールド: テープの中身を減らさず、こもらせもせずに回し続ける。新しい音は録らない。
// フェード: 録るのをやめ、残り方を「フェードの長さ」をかけて 0% まで下げていく。最初はゆっくり、最後は加速して消える。
// 消えきるか、また弾くと元に戻る。
// クリア: テープを流しきる間、戻す量と再生を絞る
let soloLatched = false;
let shiftDown = false;
let held = false;
let fading = false;
let fadeEnd = 0; // 残り方が 0% になる時刻 (AudioContext の秒)
let clearing = false;
const solo = () => soloLatched || shiftDown;
const recording = () => !solo() && !held && !fading;

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
// クリーンと切り替えられるよう、両方の道を作っておき、大きさで選ぶ。
// 弾いた音はそのまま聞かせ、テープへは録音の入口（recordGate）を通して送る
const clean = new Tone.Gain(1);
const distortion = new Tone.Distortion({ distortion: 0.8, oversample: "4x" });
const drive = new Tone.Gain(0);
const cabinet = new Tone.Filter({ type: "lowpass", frequency: 18000, Q: 0.7 });
const recordGate = new Tone.Gain(1).connect(recordIn);
synth.fan(clean, distortion);
distortion.connect(drive);
clean.connect(cabinet);
drive.connect(cabinet);
cabinet.connect(reverb);
cabinet.connect(recordGate);

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
    if (!held) loopLowpass.frequency.rampTo(lowpass, params.ramp);
  },
});

// 1 周で残る大きさ。戻す量と、テープが削る高さ・低さ（2 次のフィルターの、基音での減り方）で決まる。
// ホールド中はフィルターを開けて、そのまま残す
function turnLoss(freq: number): number {
  if (held) return 1;
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

function applySaturation() {
  saturationValueEl.value = `${saturationEl.value}%`;
  const k = MAX_SATURATION ** (Number(saturationEl.value) / 100);
  saturateIn.gain.rampTo(k, 0.1);
  saturateOut.gain.rampTo(1 / k, 0.1);
}
saturationEl.addEventListener("input", applySaturation);
applySaturation();

// フェード中に変えたときは、始めたときから数えた長さにする
let fadeStart = 0;
const showFadeLength = () => (fadeLengthValueEl.value = `${fadeLengthEl.value} s`);
fadeLengthEl.addEventListener("input", () => {
  showFadeLength();
  if (!fading) return;
  fadeEnd = fadeStart + Number(fadeLengthEl.value);
  applyLoop();
});
showFadeLength();

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

function startMark(freq: number, time: number): Mark {
  const mark: Mark = { freq, start: tapeAt(time), end: null, level: 1, turns: 0 };
  marks.push(mark);
  return mark;
}

// 状態に合わせて、戻す量・再生・録音の入口・テープのフィルターを移す。
// 押したまま録るかどうかが変わった音は、そこで録り終える（録り始める）
let wasRecording = true;
function applyLoop() {
  const now = Tone.immediate();
  feedback.gain.cancelScheduledValues(now);
  // フェード中は、フェードを始めたときに決めた時刻に 0% になるよう、今の値からまっすぐ下げる（途中で呼ばれても終わりは変わらない）
  if (fading && !clearing) {
    feedback.gain.setValueAtTime(feedback.gain.value, now).linearRampToValueAtTime(0, Math.max(fadeEnd, now + 0.05));
  } else {
    feedback.gain.setTargetAtTime(clearing ? 0 : held ? 1 : feedbackAmount(), now, 0.05);
  }
  tapeOut.gain.cancelScheduledValues(now).setTargetAtTime(clearing ? 0 : 1, now, 0.05);
  recordGate.gain.cancelScheduledValues(now).setTargetAtTime(recording() ? 1 : 0, now, 0.02);
  loopLowpass.frequency.rampTo(held ? 20000 : lowpass, 0.1);
  loopHighpass.frequency.rampTo(held ? 10 : LOOP_HIGHPASS, 0.1);

  if (recording() !== wasRecording) {
    for (const touch of touches.values()) {
      if (touch.mark) touch.mark.end = tapeAt(now);
      touch.mark = recording() ? startMark(touch.freq, now) : null;
    }
    wasRecording = recording();
  }
}

feedbackEl.addEventListener("input", () => {
  feedbackValueEl.value = `${feedbackEl.value}%`;
  applyLoop();
});
feedbackValueEl.value = `${feedbackEl.value}%`;

function toggle(button: Button) {
  if (button === "solo") soloLatched = !soloLatched;
  if (button === "hold") {
    held = !held;
    fading = false;
  }
  if (button === "fade") {
    fading = !fading;
    fadeStart = Tone.immediate();
    fadeEnd = fadeStart + Number(fadeLengthEl.value);
    held = false;
  }
  applyLoop();
}

function noteOn(pointerId: number, y: number) {
  // フェード中に弾くと、元に戻して録り始める
  if (fading) {
    fading = false;
    applyLoop();
  }
  const pitches = page.pitches();
  const index = pitchIndexAt(y, height, pitches.length);
  const { freq } = pitchAt(pitches, index);
  const now = Tone.immediate();
  synth.triggerAttack(freq, now, 0.8);
  const mark = recording() ? startMark(freq, now) : null;
  if (!mark) glows.push({ x: recX(), y: yOf(freq, pitches), life: 1, strength: 0.5 });
  touches.set(pointerId, { index, freq, mark });
}

function noteOff(pointerId: number) {
  const touch = touches.get(pointerId);
  if (!touch) return;
  const now = Tone.immediate();
  synth.triggerRelease(touch.freq, now);
  if (touch.mark) touch.mark.end = tapeAt(now);
  touches.delete(pointerId);
}

// --- 操作盤（録音ヘッドの右） ---

const BUTTONS: Button[] = ["solo", "hold", "fade"];
const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 8;

// 操作盤の配置。ボタンは下に縦に並べ、フェーダーはその上の残りを使う
function panel() {
  const left = recX() + 20;
  const right = width - 14;
  const bottom = height - 44;
  const buttonsTop = bottom - BUTTONS.length * BUTTON_HEIGHT - (BUTTONS.length - 1) * BUTTON_GAP;
  const buttons = BUTTONS.map((id, i) => ({
    id,
    x: left,
    y: buttonsTop + i * (BUTTON_HEIGHT + BUTTON_GAP),
    w: right - left,
    h: BUTTON_HEIGHT,
  }));
  const fader = { x: (left + right) / 2, top: 96, bottom: buttonsTop - 40 };
  return { left, buttons, fader };
}

const inPanel = (x: number) => x > panel().left - 8;

const faderPointers = new Set<number>();
function setFaderFrom(y: number) {
  const { fader } = panel();
  const ratio = Math.min(Math.max((fader.bottom - y) / (fader.bottom - fader.top), 0), 1);
  feedbackEl.value = String(Math.round(ratio * MAX_FEEDBACK));
  feedbackEl.dispatchEvent(new Event("input"));
}

function pressPanel(e: PointerEvent) {
  const hit = panel().buttons.find(
    (b) => e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h,
  );
  if (hit) {
    toggle(hit.id);
    return;
  }
  if (e.clientY < panel().fader.bottom + 24) {
    faderPointers.add(e.pointerId);
    setFaderFrom(e.clientY);
  }
}

canvas.addEventListener("pointerdown", async (e) => {
  canvas.setPointerCapture(e.pointerId);
  await page.ensureStarted();
  if (inPanel(e.clientX)) {
    pressPanel(e);
    return;
  }
  if (!page.started()) return;
  noteOn(e.pointerId, e.clientY);
});

// なぞって別の音高の帯に入ったら、前の音を離して次の音を弾く。同じ帯の中にいる間は、音を伸ばしたまま
canvas.addEventListener("pointermove", (e) => {
  if (faderPointers.has(e.pointerId)) {
    setFaderFrom(e.clientY);
    return;
  }
  const touch = touches.get(e.pointerId);
  if (!touch) return;
  if (pitchIndexAt(e.clientY, height, page.pitches().length) === touch.index) return;
  noteOff(e.pointerId);
  noteOn(e.pointerId, e.clientY);
});

for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, (e) => {
    const { pointerId } = e as PointerEvent;
    faderPointers.delete(pointerId);
    noteOff(pointerId);
  });
}

// キー: Shift を押している間はソロ、Space でホールド、F でフェード。
// 設定の入力欄やボタンを操作しているとき（Space でボタンが押される）は使わない
const typing = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement;
window.addEventListener("keydown", (e) => {
  if (e.key === "Shift" && !shiftDown) {
    shiftDown = true;
    applyLoop();
  }
  if (typing(e.target) || e.repeat) return;
  if (e.code === "Space") {
    e.preventDefault();
    toggle("hold");
  }
  if (e.key === "f" || e.key === "F") toggle("fade");
});
const releaseShift = () => {
  if (!shiftDown) return;
  shiftDown = false;
  applyLoop();
};
window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") releaseShift();
});
window.addEventListener("blur", releaseShift);

// テープを消す。戻す量と再生を 1 周より少し長く絞り、テープに残った音を流しきってから戻す。ホールドとフェードも解く
let clearTimer: ReturnType<typeof setTimeout> | undefined;
clearEl.addEventListener("click", () => {
  clearTimeout(clearTimer);
  clearing = true;
  held = false;
  fading = false;
  applyLoop();
  const now = Tone.immediate();
  marks = marks.filter((m) => m.end === null);
  // 押している音は、ここから録り直す
  for (const m of marks) Object.assign(m, { start: tapeAt(now), level: 1, turns: 0 });
  glows = [];
  clearTimer = setTimeout(() => {
    clearing = false;
    applyLoop();
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

function drawHead(x: number, label: string, active: boolean) {
  g.strokeStyle = active ? "rgba(232, 232, 236, 0.35)" : "rgba(232, 232, 236, 0.12)";
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

function drawPanel() {
  const { buttons, fader } = panel();
  const ratio = held ? 1 : feedback.gain.value / (MAX_FEEDBACK / 100);
  const knobY = fader.bottom - Math.min(ratio, 1) * (fader.bottom - fader.top);

  g.font = "11px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillStyle = "rgba(232, 232, 236, 0.5)";
  g.fillText(tk("tapeFeedback"), fader.x, fader.top - 14);

  g.fillStyle = "rgba(255, 255, 255, 0.08)";
  g.fillRect(fader.x - 3, fader.top, 6, fader.bottom - fader.top);
  g.fillStyle = held ? "rgba(108, 196, 255, 0.9)" : "rgba(108, 196, 255, 0.5)";
  g.fillRect(fader.x - 3, knobY, 6, fader.bottom - knobY);
  g.fillStyle = "#e8e8ec";
  g.beginPath();
  g.arc(fader.x, knobY, 7, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = "rgba(232, 232, 236, 0.7)";
  g.fillText(held ? "∞" : `${Math.round(feedback.gain.value * 100)}%`, fader.x, fader.bottom + 22);

  const on: Record<Button, boolean> = { solo: solo(), hold: held, fade: fading };
  g.font = "12px system-ui, sans-serif";
  for (const b of buttons) {
    g.fillStyle = on[b.id] ? "rgba(108, 196, 255, 0.18)" : "rgba(35, 37, 45, 0.9)";
    g.strokeStyle = on[b.id] ? "#6cc4ff" : "#3a3d48";
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, 6);
    g.fill();
    g.stroke();
    g.fillStyle = on[b.id] ? "#6cc4ff" : "#e8e8ec";
    g.fillText(tk(`tape.${b.id}`), b.x + b.w / 2, b.y + b.h / 2 + 4);
  }
}

function draw(tape: number) {
  g.fillStyle = "#1b1d23";
  g.fillRect(0, 0, width, height);
  const pitches = page.pitches();
  drawPitchGuides(g, width, height, pitches);

  // テープの帯（2 つのヘッドの間が、ちょうど 1 周分）。操作盤の下には音名の線を引かない
  g.fillStyle = "rgba(255, 255, 255, 0.025)";
  g.fillRect(playX(), 0, recX() - playX(), height);
  g.fillStyle = "#1b1d23";
  g.fillRect(recX() + 1, 0, width - recX(), height);

  for (const glow of glows) {
    g.strokeStyle = `hsla(200, 85%, 72%, ${glow.life * glow.strength * 0.8})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(glow.x, glow.y, 6 + (1 - glow.life) * 40, 0, Math.PI * 2);
    g.stroke();
  }

  for (const m of marks) drawMark(m, tape, pitches);
  drawHead(playX(), tk("tape.playHead"), true);
  // 録っていない間（ソロ・ホールド・フェード）は、録音ヘッドを淡くする
  drawHead(recX(), tk("tape.recHead"), recording());
  drawPanel();
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
    glows.push({ x: playX(), y: yOf(m.freq, pitches), life: 1, strength: Math.min(1, m.level) });
    m.level *= turnLoss(m.freq) ** (turns - m.turns);
    m.turns = turns;
  }
  marks = marks.filter((m) => m.level >= SILENT_LEVEL);

  // フェードで消えきったら、元に戻す
  if (fading && marks.length === 0) {
    fading = false;
    applyLoop();
  }

  for (const glow of glows) glow.life -= dt * 1.2;
  glows = glows.filter((glow) => glow.life > 0);

  draw(tape);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
