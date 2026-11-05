import * as Tone from "tone";
import "../ripples/style.css";
import { drawPitchGuides, pitchAt, pitchIndexAt, type Pitch } from "../scales";
import { setupCanvas, setupGenerativePage } from "../generative";
import { onLangChange, tk } from "../i18n";
import { setupLevel } from "../levels";
import { celloBassVoice, celloVoice, sawVoice, stringsVoice, type Voice } from "./voices";

// 1 本のテープに録った音が、再生ヘッドから録音ヘッドへ戻されて何度も録り重ねられる
// （ブライアン・イーノ『Discreet Music』、ロバート・フリップとイーノの 2 台のテープレコーダーの仕組み）。
// 戻るたびに少し小さく、こもっていくので、古い層ほど遠くに聞こえる。
// 画面は流れるテープで、右の録音ヘッドで録られた音が左へ流れ、左の再生ヘッドで鳴って、また右から（薄くなって）出てくる。
// 録音ヘッドの右は演奏中に触る操作盤で、残り方のフェーダーと、ソロ・ホールド・フェード・マイクのボタンを置く。
// 弾く音は「テープの音」と「ソロの音」の 2 つのパートに分かれ、それぞれ音色・音域・大きさ・ドラッグを持つ。
// ソロのときはソロの音で鳴る。「ソロの音もテープに録る」がオンなら、2 つ目の音色としてテープに重ね、
// オフなら録らずに聞かせるだけ（フリップのように、テープの土台の上で別の音色で即興する）

// 弾いた 1 音。テープに録られた音はスケールを変えても変わらないので、周波数で持つ。
// 位置はテープが進んだ周の数（tapeAt）で持つ。1 周の長さを変えても、テープの上の位置は変わらない
type Mark = {
  part: PartId; // どちらのパートの音で録ったか（描く色を分ける）
  freq: number;
  start: number; // 録り始めたときのテープの位置 (周)
  end: number | null; // 押している間は null
  level: number; // 今の周の大きさ（1 = 弾いたとき）
  turns: number; // level に反映した周の数
  bends: { at: number; freq: number }[]; // 「なめらかにつなぐ」で、途中で変えた音程（テープの位置 (周) と周波数）
};
type Glow = { x: number; y: number; life: number; strength: number };
// 押している指（マウス）ごとに、今鳴らしている音。テープに録っていない（ソロなど）ときは mark が null。
// 指ごとに鳴らしている声（voice）。「なめらかにつなぐ」（glide）では、その声の音程を動かす。freq は今の（向かっている）音程
type Touch = {
  part: PartId;
  index: number;
  freq: number;
  mark: Mark | null;
  voice: Voice;
  glide: boolean;
  lastMove: number; // 最後に指が動いた時刻 (performance.now)
  settled: boolean; // 指が止まって、スケールの音へ寄せたあとか
  pressY: number; // 押した高さ
  sliding: boolean; // 押した高さから DRAG_DISTANCE 以上動いて、音程を動かし始めたか
};
type Button = "solo" | "hold" | "fade" | "mic";
type PartId = "tape" | "solo";

const LOOP_LOWPASS = 3200; // 1 周ごとに高い音を削る (Hz)
// 1 周の長さを変えるときに移す時間 (秒)。スライダーの動きにすぐ付いていくよう短くする。
// 長さが変わる間は、ヘッドを動かしたのと同じで、速く動かすほど音程が大きくうねる（長くすると下がり、短くすると上がる）
const LENGTH_RAMP = 0.08;
const MAX_SATURATION = 16; // 歪み 100% で、戻す音を飽和させる前に何倍にするか
const MAX_FEEDBACK = 98; // 残り方の上限 (%)。100% はホールドだけ
const SILENT_LEVEL = 0.02; // これより小さくなった音は画面から消す
const GLIDE_FOLLOW = 0.015; // 「なめらかにつなぐ」で、指の高さに音程が追いつく速さ（時定数, 秒）
const SETTLE_AFTER = 120; // 指がこれ (ミリ秒) 止まったら、近くのスケールの音へ寄せる
const SETTLE_TIME = 0.06; // 寄せる速さ（時定数, 秒）
// 押した高さからこれ (px) 動くまでは、音程を動かさない。クリックのときの指のぶれで、立ち上がりの直後に音程が揺れないように
const DRAG_DISTANCE = 4;
const MIC_GATE = -50; // マイクの音がこれ (dB) より小さいあいだは録らない（部屋の雑音を積もらせない）
const IDLE_BEFORE_AUTO = 10; // 弾かない（マイクにも音が入らない）状態が何秒続いたら、自動で弾き始めるか
const AUTO_INTERVAL = 4; // 自動で弾く間隔の目安 (秒)。密度と天気で変わる
const AUTO_RETRY = 0.5; // 録音ヘッドの前が埋まっていたら、何秒後に見直すか
const AUTO_WINDOW = 0.06; // 録音ヘッドのまわりの、テープのどれだけ（周）を見て埋まり具合を測るか
const AUTO_CROWDED = 0.6; // 埋まり具合がこれより大きければ、自動では弾かない
const MIC_ACTIVE = 0.02; // マイクの音がこれより大きいあいだは、弾いているとみなして自動を休む
const MIC_BINS = 400; // マイクの音の大きさを、テープ 1 周あたりこの数に分けて覚えておく（画面に描く用）
const PLAY_HEAD = 0.18; // 再生ヘッドの横位置（画面の幅に対する割合）
const REC_HEAD = 0.82; // 録音ヘッドの横位置
// 足す再生ヘッド。テープの途中を読んで鳴らすだけで、テープへは戻さない（1 周に同じ音が何度か、ずれて聞こえる）。
// 位置 u はテープの上の位置（0 = 録音ヘッド、1 = 再生ヘッド）。帯の下のつまみで動かす
const EXTRA_HEADS = [0.5, 0.25, 0.75]; // 足せる数と、はじめの位置
const EXTRA_HEAD_LEVEL = 0.7; // 足した再生ヘッドの大きさ（元の再生ヘッドに対して）
const EXTRA_HEAD_MIN = 0.03; // つまみで動かせる範囲（録音ヘッド・再生ヘッドと重ならないように）
// 傷み: 回るたびにテープが少しずつ傷む。1 周ごとに高い音を削り（こもり）、回転の揺れ（ワウ・フラッター）とノイズを入れる。
// どれも 1 周ごとに重なるので、古い層ほど傷む。
// こもりは、テープが削る高さとは別に、削る高さを 20 kHz からこれだけ (オクターブ) 下げて作る
const WEAR_DARKEN = 4.5;
// テープが削るフィルターの Q (dB)。削る高さのすぐ手前に山のない（バターワースの）形にする。
// 山があると、その高さの音が 1 周ごとに持ち上がって積み重なり、残り方が高いと周を追うごとに大きくなってしまう。
// Tone のフィルターは負の Q を受け付けないので、Web Audio のフィルターを使う
const FLAT_Q = -3.01;
const WOW = { rate: 0.6, depth: 0.0015 }; // ゆっくりした揺れ（速さ Hz、ずれる時間の幅 秒）。100% で 1 周ごとに ±10 セントほど
const FLUTTER = { rate: 6.5, depth: 0.00012 }; // 細かい揺れ。100% で 1 周ごとに ±8 セントほど
const WOW_BASE = 0.005; // 揺れを作る短い遅れ (秒)。その分、テープの遅れを短くして 1 周の長さを保つ
const HISS = 0.25; // 100% で、1 周ごとに入れるノイズの大きさ（テープに載っている音に対して）。およそ -20 dB
const GRIP = { width: 34, height: 18, bottom: 30 }; // つまみの大きさと、下端から上げる高さ (px)

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
const lowCutEl = document.querySelector<HTMLInputElement>("#tape-low-cut")!;
const lowCutValueEl = document.querySelector<HTMLOutputElement>("#tape-low-cut-value")!;
const micLevelEl = document.querySelector<HTMLInputElement>("#mic-level")!;
const micLevelValueEl = document.querySelector<HTMLOutputElement>("#mic-level-value")!;
const micEchoCancelEl = document.querySelector<HTMLInputElement>("#mic-echo-cancel")!;
const micStatusEl = document.querySelector<HTMLElement>("#mic-status")!;
const autoEl = document.querySelector<HTMLInputElement>("#auto")!;
const wearEl = document.querySelector<HTMLInputElement>("#tape-wear")!;
const wearValueEl = document.querySelector<HTMLOutputElement>("#tape-wear-value")!;
const soloRecordEl = document.querySelector<HTMLInputElement>("#solo-record")!;
const extraHeadsEl = document.querySelector<HTMLInputElement>("#extra-heads")!;
const extraHeadsValueEl = document.querySelector<HTMLOutputElement>("#extra-heads-value")!;

const loopSeconds = () => Number(lengthEl.value);
const feedbackAmount = () => Number(feedbackEl.value) / 100;
// 1 周ごとに低い音を削る (Hz)。低音がたまって濁らないように。下げるとコントラバスの低音も繰り返し残る
const lowCut = () => Number(lowCutEl.value);
const wear = () => Number(wearEl.value) / 100;

// --- 演奏の状態 ---

// ソロ: ソロの音で弾く（ボタンで切り替えるか、Shift を押している間）。「ソロの音もテープに録る」がオフなら、テープには録らない。
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
const recording = () => (!solo() || soloRecordEl.checked) && !held && !fading;

// --- 音 ---

// 弾いた音（その場で聞こえる音）と、テープから戻ってきた音は、同じリバーブへ送る
const reverb = new Tone.Reverb({ decay: 6, wet: 0.35 }).toDestination();

// テープ: 録音ヘッド → (1 周の秒数) → 再生ヘッド。再生した音は削ってから録音ヘッドへ戻す。
// 戻す音は飽和させ、重ねすぎても大きくなり続けないようにする。「歪み」では、飽和させる前に大きくして後で同じだけ戻す。
// 小さい音の残り方は変わらず、層が厚くなるほど早く、強く歪む
const recordIn = new Tone.Gain(1);
const writeBus = new Tone.Gain(1); // 録音ヘッドでテープに書く音（弾いた音と、戻した音）
const tapeDelay = new Tone.Delay({ delayTime: loopSeconds() - WOW_BASE, maxDelay: 30 });
function flatFilter(type: BiquadFilterType, frequency: number) {
  const filter = Tone.getContext().createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = FLAT_Q;
  return filter;
}
const loopLowpass = flatFilter("lowpass", LOOP_LOWPASS);
const loopHighpass = flatFilter("highpass", lowCut());
const saturateIn = new Tone.Gain(1);
const saturate = new Tone.WaveShaper((x) => Math.tanh(x), 4096);
const saturateOut = new Tone.Gain(1);
const feedback = new Tone.Gain(feedbackAmount());
const tapeOut = new Tone.Gain(1).connect(reverb);
recordIn.connect(writeBus);
writeBus.connect(tapeDelay);

// 傷み。回転の揺れは、テープの遅れに続く短い遅れの長さを 2 つの LFO で揺らして作る
// （LFO をつなぐと、つないだ先の値は上書きされるので、ゆっくりした揺れの中心を WOW_BASE にする）。
// ノイズは、テープに載っている音の大きさに合わせて、再生ヘッドで入れる（空のテープでは鳴らない。フェードやクリアで一緒に消える）。
// 入れたノイズも録音ヘッドへ戻されるので、回るたびに積もり、古いものほどこもっていく
const wearLowpass = flatFilter("lowpass", 20000);
const wobble = new Tone.Delay({ delayTime: WOW_BASE, maxDelay: 0.05 });
const wow = new Tone.LFO({ frequency: WOW.rate, min: WOW_BASE, max: WOW_BASE }).start();
const flutter = new Tone.LFO({ frequency: FLUTTER.rate, min: 0, max: 0 }).start();
wow.connect(wobble.delayTime);
flutter.connect(wobble.delayTime);
const hiss = new Tone.Noise("white").start();
const hissFilter = new Tone.Filter({ type: "bandpass", frequency: 5000, Q: 0.4 });
const hissLevel = new Tone.Gain(0);
const follower = new Tone.Follower(0.05);
const hissAmount = new Tone.Gain(0);
hiss.chain(hissFilter, hissLevel, saturateIn);
follower.connect(hissAmount);
hissAmount.connect(hissLevel.gain);

tapeDelay.chain(wobble, wearLowpass, loopLowpass, loopHighpass, saturateIn, saturate, saturateOut);
saturateOut.connect(feedback);
feedback.connect(writeBus);
Tone.connect(loopHighpass, follower); // ノイズを入れる前の大きさを見る
saturateOut.connect(tapeOut);

// 足す再生ヘッド。書いた音を u 周分遅らせて鳴らす。使わないヘッドは絞っておく
const extraHeads = EXTRA_HEADS.map((u) => {
  const delay = new Tone.Delay({ delayTime: u * loopSeconds(), maxDelay: 30 });
  const level = new Tone.Gain(0);
  writeBus.chain(delay, level, tapeOut);
  return { u, delay, level };
});
const extraHeadCount = () => Number(extraHeadsEl.value);
const activeHeads = () => extraHeads.slice(0, extraHeadCount());
function applyExtraHeads() {
  extraHeadsValueEl.value = extraHeadsEl.value;
  extraHeads.forEach((head, i) => head.level.gain.rampTo(i < extraHeadCount() ? EXTRA_HEAD_LEVEL : 0, 0.1));
}
extraHeadsEl.addEventListener("input", applyExtraHeads);
applyExtraHeads();

// --- 2 つのパート ---

// 録音の入口。弾いた音とマイクはここを通ってテープへ入る（ホールド・フェード中と、録らない設定のソロ中は閉じる）
const recordGate = new Tone.Gain(1).connect(recordIn);

// パートごとの音色と大きさ。声はパートの入口（clean と distortion の両方）へつなぎ、音色の「ドライブ」では
// 歪ませてからギターアンプのスピーカーのように高音を丸める（フリップの歪んだギターのように）。
// クリーンと切り替えられるよう両方の道を作っておき、大きさで選ぶ。チェロとクリーンは歪ませない道を通る
type Part = {
  timbreEl: HTMLSelectElement;
  dragEl: HTMLSelectElement;
  clean: Tone.Gain;
  distortion: Tone.Distortion;
};

const DRIVE_LEVEL = 0.12; // 歪ませると大きくなるので、クリーンと同じくらいに揃える
const NORMAL_VOLUME = 80; // 大きさのスライダーで、元の大きさ（1 倍）になる値

function createPart(id: PartId, destinations: Tone.InputNode[]): Part {
  const timbreEl = document.querySelector<HTMLSelectElement>(`#${id}-timbre`)!;
  const dragEl = document.querySelector<HTMLSelectElement>(`#${id}-drag`)!;
  const volumeEl = document.querySelector<HTMLInputElement>(`#${id}-volume`)!;
  const volumeValueEl = document.querySelector<HTMLOutputElement>(`#${id}-volume-value`)!;
  const clean = new Tone.Gain(1);
  const distortion = new Tone.Distortion({ distortion: 0.8, oversample: "4x" });
  const drive = new Tone.Gain(0);
  const cabinet = new Tone.Filter({ type: "lowpass", frequency: 18000, Q: 0.7 });
  const volume = new Tone.Gain(1);
  distortion.connect(drive);
  clean.connect(cabinet);
  drive.connect(cabinet);
  cabinet.connect(volume);
  volume.fan(...destinations);

  const applyTimbre = () => {
    const driven = timbreEl.value === "drive";
    clean.gain.rampTo(driven ? 0 : 1, 0.05);
    drive.gain.rampTo(driven ? DRIVE_LEVEL : 0, 0.05);
    cabinet.frequency.rampTo(driven ? 3800 : 18000, 0.05);
  };
  timbreEl.addEventListener("change", applyTimbre);
  applyTimbre();

  // 大きさは、スライダーの値の 2 乗で（耳に自然な変わり方で）変える
  const applyVolume = () => {
    volumeValueEl.value = `${volumeEl.value}%`;
    volume.gain.rampTo((Number(volumeEl.value) / NORMAL_VOLUME) ** 2, 0.05);
  };
  volumeEl.addEventListener("input", applyVolume);
  applyVolume();

  return { timbreEl, dragEl, clean, distortion };
}

const parts: Record<PartId, Part> = {
  tape: createPart("tape", [reverb, recordGate]),
  solo: createPart("solo", [reverb, recordGate]),
};

// 1 音ごとに声を作って鳴らし、鳴り終わったら捨てる。どの弾き方でも、自動でも、同じ作り方で同じ音にする
function makeVoice(id: PartId): Voice {
  const { timbreEl, clean, distortion } = parts[id];
  if (timbreEl.value === "cello") return celloVoice([clean, distortion]);
  if (timbreEl.value === "cello-bass") return celloBassVoice([clean, distortion]);
  if (timbreEl.value === "strings") return stringsVoice([clean, distortion]);
  return sawVoice(timbreEl.value === "drive", [clean, distortion]);
}

// 離した（release を始めた）声を、余韻が消えたあとに捨てる
function disposeAfter(voice: Voice, releaseAt: number) {
  const ms = (releaseAt - Tone.immediate() + voice.release + 1) * 1000;
  setTimeout(() => voice.dispose(), ms);
}

// --- マイク ---

// マイクの音は、部屋で生の音が聞こえているので、そのまま鳴らさずテープにだけ録る（スピーカーから鳴らすとすぐハウリングする）。
// 小さい音はゲートで切り、強弱はコンプレッサーで揃え、低い雑音（机の振動など）は削る。
// 弾いた音と同じく、録らないとき（ホールド・フェード、録らない設定のソロ）は録らない
const micIn = new Tone.Gain(1);
const micGate = new Tone.Gate({ threshold: MIC_GATE, smoothing: 0.1 });
const micCompressor = new Tone.Compressor({ threshold: -24, ratio: 4 });
const micHighpass = new Tone.Filter({ type: "highpass", frequency: 80 });
const micMeter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
micIn.chain(micGate, micCompressor, micHighpass, recordGate);
micHighpass.connect(micMeter);

let micStream: MediaStream | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let micOpening = false;
let micStatus: string | null = null; // 表示している文言のキー
const micOn = () => micStream !== null;

function showMicStatus(key: string | null) {
  micStatus = key;
  micStatusEl.textContent = key ? tk(key) : "";
}
onLangChange(() => showMicStatus(micStatus));

// ブラウザのノイズ除去と自動音量調整は切る（伸ばした音を雑音として消してしまうため）。
// エコー除去はスピーカーで聴くとき用で、テープから鳴った音がまたマイクに入って積もるのを抑える。ヘッドホンなら切ったほうが音がよい
async function openMic() {
  micOpening = true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: micEchoCancelEl.checked, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    console.warn(e);
    showMicStatus("micStatus.denied");
    return;
  } finally {
    micOpening = false;
  }
  micSource = Tone.getContext().createMediaStreamSource(micStream);
  Tone.connect(micSource, micIn);
  showMicStatus(micEchoCancelEl.checked ? "micStatus.on" : "micStatus.headphones");
}

function closeMic() {
  micSource?.disconnect();
  for (const track of micStream?.getTracks() ?? []) track.stop();
  micSource = null;
  micStream = null;
  showMicStatus(null);
}

// エコー除去を切り替えたら、マイクを開き直す
micEchoCancelEl.addEventListener("change", () => {
  if (!micOn()) return;
  closeMic();
  void openMic();
});

const showMicLevel = () => (micLevelValueEl.value = `${micLevelEl.value}%`);
micLevelEl.addEventListener("input", () => {
  showMicLevel();
  micIn.gain.rampTo(Number(micLevelEl.value) / 100, 0.05);
});
showMicLevel();
micIn.gain.value = Number(micLevelEl.value) / 100;

// 天気: 空模様でテープが削る高さ（晴れで明るく、雨でこもる）、雲でリバーブが変わる。
// 変化: 天気で決まった値を中心に、音域・テープの明るさ・リバーブがゆっくり揺れ、20 分ごとに 5 度上へ転調する
let lowpass = LOOP_LOWPASS;
const wearCutoff = (w = wear()) => 20000 * 2 ** (-WEAR_DARKEN * w);
const page = setupGenerativePage({
  defaults: { scale: "major-pentatonic", root: "A" },
  reverb: { node: reverb, wet: 0.35, decay: 6 },
  applyParams: (params) => {
    lowpass = LOOP_LOWPASS * 2 ** (params.drift.brightness + params.mood.brightness);
    if (!held) loopLowpass.frequency.setTargetAtTime(lowpass, Tone.immediate(), Math.max(params.ramp / 3, 0.01));
  },
});

// ソロの音域。テープの音の音域は、設定の「音域」（ほかのページと共通）
let soloRegister = setupLevel(
  document.querySelector<HTMLInputElement>("#solo-register")!,
  document.querySelector<HTMLOutputElement>("#solo-register-value")!,
  "solo-register",
  (level) => (soloRegister = level),
);
const pitchesOf = (part: PartId) => (part === "tape" ? page.pitches() : page.pitchesFor(soloRegister));
// 今弾くと鳴るパート
const currentPart = (): PartId => (solo() ? "solo" : "tape");

// 1 周で残る大きさ。戻す量と、テープが削る高さ・低さ（2 次のフィルターの、基音での減り方）で決まる。
// ホールド中はフィルターを開けて、そのまま残す
function turnLoss(freq: number): number {
  if (held) return 1;
  const low = 1 / Math.sqrt((1 + (freq / lowpass) ** 4) * (1 + (freq / wearCutoff()) ** 4));
  const high = 1 / Math.sqrt(1 + (lowCut() / freq) ** 4);
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
  tapeDelay.delayTime.rampTo(loopSeconds() - WOW_BASE, LENGTH_RAMP, now);
  for (const head of extraHeads) head.delay.delayTime.rampTo(head.u * loopSeconds(), LENGTH_RAMP, now);
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
// テープの位置ごとの、マイクの音の大きさ。添え字は 1 周の中の位置
const micTrack = new Float32Array(MIC_BINS);
let lastTape: number | null = null;

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

function startMark(part: PartId, freq: number, time: number): Mark {
  const mark: Mark = { part, freq, start: tapeAt(time), end: null, level: 1, turns: 0, bends: [] };
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
  loopLowpass.frequency.setTargetAtTime(held ? 20000 : lowpass, now, 0.03);
  // ホールド中は傷ませない（中身をそのまま回し続ける）
  const w = held ? 0 : wear();
  wearLowpass.frequency.setTargetAtTime(wearCutoff(w), now, 0.05);
  wow.min = WOW_BASE - WOW.depth * w;
  wow.max = WOW_BASE + WOW.depth * w;
  flutter.min = -FLUTTER.depth * w;
  flutter.max = FLUTTER.depth * w;
  hissAmount.gain.rampTo(HISS * w, 0.1);
  loopHighpass.frequency.setTargetAtTime(held ? 10 : lowCut(), now, 0.03);

  if (recording() !== wasRecording) {
    for (const touch of touches.values()) {
      if (touch.mark) touch.mark.end = tapeAt(now);
      touch.mark = recording() ? startMark(touch.part, touch.freq, now) : null;
    }
    wasRecording = recording();
  }
}

soloRecordEl.addEventListener("change", applyLoop);

const showWear = () => (wearValueEl.value = `${wearEl.value}%`);
wearEl.addEventListener("input", () => {
  showWear();
  applyLoop();
});
showWear();

const showLowCut = () => (lowCutValueEl.value = `${lowCutEl.value} Hz`);
lowCutEl.addEventListener("input", () => {
  showLowCut();
  applyLoop();
});
showLowCut();

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
  if (button === "mic") {
    if (micOn()) closeMic();
    else if (!micOpening) void openMic();
  }
  if (button === "fade") {
    fading = !fading;
    fadeStart = Tone.immediate();
    fadeEnd = fadeStart + Number(fadeLengthEl.value);
    held = false;
  }
  applyLoop();
}

// --- 自動 ---

// 録音ヘッドのまわりのテープが、どれだけ埋まっているか。そこにある音とマイクの音の大きさを足す
function crowdingAtRecHead(tape: number): number {
  const here = ((tape % 1) + 1) % 1;
  let sum = 0;
  for (const m of marks) {
    // 録音ヘッドの今の位置が、音の頭からどれだけ後ろか (周)。音の長さ（前後に AUTO_WINDOW の余裕）の中なら埋まっている
    const offset = (((here - m.start) % 1) + 1) % 1;
    const length = Math.min(Math.min(m.end ?? tape, tape) - m.start, 1);
    if (offset < length + AUTO_WINDOW || offset > 1 - AUTO_WINDOW) sum += Math.min(1, m.level);
  }
  const bin = Math.floor(here * MIC_BINS);
  for (let i = -3; i <= 3; i++) sum += micTrack[(bin + i + MIC_BINS) % MIC_BINS] * 2 / 7;
  return sum;
}

// いちばん近いスケールの音の番号
function nearestIndex(pitches: Pitch[], freq: number): number {
  let index = 0;
  pitches.forEach((p, i) => {
    if (Math.abs(Math.log(p.freq / freq)) < Math.abs(Math.log(pitches[index].freq / freq))) index = i;
  });
  return index;
}

// 縦位置の周波数。yOf の逆で、音高の線の間は対数で補う
function freqAtY(y: number, pitches: Pitch[]): number {
  const band = height / pitches.length;
  const index = Math.min(Math.max((height - y) / band - 0.5, 0), pitches.length - 1);
  const i = Math.min(Math.floor(index), pitches.length - 2);
  return pitches[i].freq * (pitches[i + 1].freq / pitches[i].freq) ** (index - i);
}

// 今テープに残っている音から 1 つ選び（大きい音ほど選ばれやすい）、その近くのスケールの音を返す。
// 何も残っていなければ、画面の中ほどから選ぶ
function autoPitch(pitches: Pitch[]): Pitch {
  const total = marks.reduce((sum, m) => sum + Math.min(1, m.level), 0);
  if (total === 0) return pitchAt(pitches, Math.floor(pitches.length * (0.3 + Math.random() * 0.4)));
  let pick = Math.random() * total;
  const source = marks.find((m) => (pick -= Math.min(1, m.level)) <= 0) ?? marks[marks.length - 1];
  const index = nearestIndex(pitches, source.freq);
  const steps = [-2, -1, 1, 2, 3][Math.floor(Math.random() * 5)];
  return pitchAt(pitches, index + steps);
}

function playAuto() {
  const pitches = page.pitches();
  const { freq } = autoPitch(pitches);
  const now = Tone.immediate();
  const duration = 0.4 + Math.random() * 2.2;
  const voice = makeVoice("tape");
  voice.triggerAttack(freq, now, 0.45 + Math.random() * 0.25);
  voice.triggerRelease(now + duration);
  disposeAfter(voice, now + duration);
  const mark = startMark("tape", freq, now);
  mark.end = tapeAt(now + duration);
}

let idle = 0;
let untilAuto = 0;

// 弾いていない間だけ自動で弾く。ソロ中と、録っていないとき（ホールド・フェード）は弾かない
function updateAuto(dt: number, tape: number) {
  if (micOn() && (micMeter.getValue() as number) > MIC_ACTIVE) idle = 0;
  if (touches.size > 0) idle = 0;
  idle += dt;
  if (!page.started() || !autoEl.checked || !recording() || solo() || clearing || idle < IDLE_BEFORE_AUTO) return;
  untilAuto -= dt;
  if (untilAuto > 0) return;
  if (crowdingAtRecHead(tape) > AUTO_CROWDED) {
    untilAuto = AUTO_RETRY;
    return;
  }
  playAuto();
  untilAuto = (AUTO_INTERVAL / page.autoDensity()) * (0.5 + Math.random());
}

// 押した瞬間に鳴らし、離すまで伸ばす。「なめらかにつなぐ」では、動かすと音程が滑る。
// ソロのときはソロの音（テープへはつながっていない）で、それ以外はテープの音で鳴らす
function noteOn(pointerId: number, y: number) {
  idle = 0;
  // フェード中に弾くと、元に戻して録り始める
  if (fading) {
    fading = false;
    applyLoop();
  }
  const part = currentPart();
  const pitches = pitchesOf(part);
  const index = pitchIndexAt(y, height, pitches.length);
  const { freq } = pitchAt(pitches, index);
  const now = Tone.immediate();
  const voice = makeVoice(part);
  voice.triggerAttack(freq, now, 0.8);
  const mark = recording() ? startMark(part, freq, now) : null;
  if (!mark) glows.push({ x: recX(), y: yOf(freq, pitches), life: 1, strength: 0.5 });
  const glide = parts[part].dragEl.value === "glide";
  touches.set(pointerId, { part, index, freq, mark, voice, glide, lastMove: performance.now(), settled: true, pressY: y, sliding: false });
}

// 「なめらかにつなぐ」の音程を freq へ動かし、テープに録っていれば、その音程の変化も覚えておく
function bend(touch: Touch, freq: number, timeConstant: number) {
  const now = Tone.immediate();
  touch.voice.frequency.cancelScheduledValues(now).setTargetAtTime(freq, now, timeConstant);
  touch.freq = freq;
  touch.mark?.bends.push({ at: tapeAt(now + timeConstant * 2), freq });
}

// 指が止まった音を、近くのスケールの音へ寄せる（毎フレーム呼ぶ）
function settleGlides() {
  for (const touch of touches.values()) {
    if (!touch.glide || touch.settled || performance.now() - touch.lastMove < SETTLE_AFTER) continue;
    const pitches = pitchesOf(touch.part);
    bend(touch, pitches[nearestIndex(pitches, touch.freq)].freq, SETTLE_TIME);
    touch.settled = true;
  }
}

function noteOff(pointerId: number) {
  const touch = touches.get(pointerId);
  if (!touch) return;
  touches.delete(pointerId);
  const now = Tone.immediate();
  touch.voice.triggerRelease(now);
  disposeAfter(touch.voice, now);
  if (touch.mark) touch.mark.end = tapeAt(now);
}

// --- 操作盤（録音ヘッドの右） ---

const BUTTONS: Button[] = ["solo", "hold", "fade", "mic"];
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

// 足した再生ヘッドのつまみ。重なっていたら、後ろ（上に描いた方）を取る
function gripRect(u: number) {
  const x = xAt(u);
  const bottom = height - GRIP.bottom;
  return { left: x - GRIP.width / 2, right: x + GRIP.width / 2, top: bottom - GRIP.height, bottom };
}
function headAt(x: number, y: number) {
  return [...activeHeads()].reverse().find((head) => {
    const r = gripRect(head.u);
    return x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4;
  });
}

// つまみで動かす。動かす速さの分だけ、そのヘッドの音の音程がうねる（1 周の長さを変えたときと同じ）
const headPointers = new Map<number, (typeof extraHeads)[number]>();
function moveHead(head: (typeof extraHeads)[number], x: number) {
  const u = (recX() - x) / (recX() - playX());
  head.u = Math.min(Math.max(u, EXTRA_HEAD_MIN), 1 - EXTRA_HEAD_MIN);
  head.delay.delayTime.rampTo(head.u * loopSeconds(), LENGTH_RAMP);
}

canvas.addEventListener("pointerdown", async (e) => {
  canvas.setPointerCapture(e.pointerId);
  await page.ensureStarted();
  if (inPanel(e.clientX)) {
    pressPanel(e);
    return;
  }
  const head = headAt(e.clientX, e.clientY);
  if (head) {
    headPointers.set(e.pointerId, head);
    return;
  }
  if (!page.started()) return;
  noteOn(e.pointerId, e.clientY);
});

// 「音階で弾く」: なぞって別の音高の帯に入ったら、前の音を離して次の音を弾く。同じ帯の中にいる間は、音を伸ばしたまま。
// 「なめらかにつなぐ」: 同じ音を伸ばしたまま、指の高さへ音程を動かす
canvas.addEventListener("pointermove", (e) => {
  if (faderPointers.has(e.pointerId)) {
    setFaderFrom(e.clientY);
    return;
  }
  const head = headPointers.get(e.pointerId);
  if (head) {
    moveHead(head, e.clientX);
    return;
  }
  const touch = touches.get(e.pointerId);
  if (!touch) {
    canvas.style.cursor = headAt(e.clientX, e.clientY) ? "ew-resize" : "";
    return;
  }
  if (touch.glide) {
    if (!touch.sliding && Math.abs(e.clientY - touch.pressY) < DRAG_DISTANCE) return;
    touch.sliding = true;
    // 押した高さからの移動の分だけ音程を動かす。押した位置が帯の中心からずれていても、押した瞬間の音から滑らかに始まる
    const pitches = pitchesOf(touch.part);
    const start = pitchAt(pitches, touch.index);
    bend(touch, (start.freq * freqAtY(e.clientY, pitches)) / freqAtY(touch.pressY, pitches), GLIDE_FOLLOW);
    touch.lastMove = performance.now();
    touch.settled = false;
    return;
  }
  if (pitchIndexAt(e.clientY, height, pitchesOf(touch.part).length) === touch.index) return;
  noteOff(e.pointerId);
  noteOn(e.pointerId, e.clientY);
});

for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, (e) => {
    const { pointerId } = e as PointerEvent;
    faderPointers.delete(pointerId);
    headPointers.delete(pointerId);
    noteOff(pointerId);
  });
}

// キー: Shift を押している間はソロ、Space でホールド、F でフェード、M でマイク。
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
  if (e.key === "m" || e.key === "M") toggle("mic");
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
  for (const m of marks) Object.assign(m, { start: tapeAt(now), level: 1, turns: 0, bends: [] });
  glows = [];
  micTrack.fill(0);
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
  const head = age % 1; // 音の頭の位置
  const length = Math.min(Math.min(m.end ?? tape, tape) - m.start, 1); // 自動で弾いた音は、終わりを先に決めてある
  const alpha = Math.min(1, m.level) * 0.9;
  const hue = m.part === "tape" ? 200 : 280; // テープの音は青、ソロの音は紫
  // 傷んだテープでは、回った数だけ色があせる
  const fade = Math.min(0.8, m.turns * wear() * 0.15);

  // 音の頭からの距離 (周) と縦位置の点を並べる。音程を変えていなければ、頭と終わりの 2 点
  const points = [{ offset: 0, y: yOf(m.freq, pitches) }];
  for (const b of m.bends) {
    const offset = b.at - m.start;
    if (offset > length) break;
    points.push({ offset, y: yOf(b.freq, pitches) });
  }
  points.push({ offset: length, y: points[points.length - 1].y });

  // テープの上の位置は head - offset。負になったところは前の周の分で、再生ヘッドの手前（+1）に描く
  g.strokeStyle = `hsla(${hue}, ${85 * (1 - fade)}%, 72%, ${alpha})`;
  g.lineWidth = 3;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(xAt(head), points[0].y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const ua = head - a.offset;
    const ub = head - b.offset;
    if (ua >= 0 && ub < 0) {
      // 録音ヘッドの位置（u = 0）で切って、続きを再生ヘッドの手前から描く
      const y = a.y + ((b.y - a.y) * ua) / (ua - ub);
      g.lineTo(xAt(0), y);
      g.moveTo(xAt(1), y);
    }
    g.lineTo(xAt(ub < 0 ? ub + 1 : ub), b.y);
  }
  g.stroke();

  const y = points[0].y;
  g.fillStyle = `hsla(${hue}, ${90 * (1 - fade)}%, 82%, ${alpha})`;
  g.beginPath();
  g.arc(xAt(head), y, 3.5, 0, Math.PI * 2);
  g.fill();
}

// マイクの音は音程を持たないので、テープの縦の中央に、波形のような濃淡で描く
function drawMicTrack(tape: number) {
  const barWidth = (recX() - playX()) / MIC_BINS + 1;
  const middle = height / 2;
  for (let b = 0; b < MIC_BINS; b++) {
    const level = Math.min(1, micTrack[b] * 2.5);
    if (level < 0.01) continue;
    const u = (((tape - b / MIC_BINS) % 1) + 1) % 1;
    const half = level * height * 0.3;
    g.fillStyle = `rgba(255, 196, 140, ${0.04 + 0.16 * level})`;
    g.fillRect(xAt(u) - barWidth / 2, middle - half, barWidth, half * 2);
  }
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

// 足した再生ヘッドは、元の再生ヘッドより淡い線と、名前を書いたつまみで描く
function drawExtraHead(u: number) {
  const x = xAt(u);
  g.strokeStyle = "rgba(232, 232, 236, 0.18)";
  g.lineWidth = 1;
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, height);
  g.stroke();
  g.setLineDash([]);
  const r = gripRect(u);
  g.fillStyle = "rgba(35, 37, 45, 0.9)";
  g.strokeStyle = "#3a3d48";
  g.beginPath();
  g.roundRect(r.left, r.top, r.right - r.left, r.bottom - r.top, 5);
  g.fill();
  g.stroke();
  g.fillStyle = "rgba(232, 232, 236, 0.7)";
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(tk("tape.playHead"), x, r.bottom - 5);
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

  const on: Record<Button, boolean> = { solo: solo(), hold: held, fade: fading, mic: micOn() };
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
  // 音名の線は、今弾くと鳴るパートの音域で引く。テープの音は、テープの音の音域で描く
  drawPitchGuides(g, width, height, pitchesOf(currentPart()));
  const pitches = page.pitches();

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

  drawMicTrack(tape);
  for (const m of marks) drawMark(m, tape, pitches);
  drawHead(playX(), tk("tape.playHead"), true);
  for (const head of activeHeads()) drawExtraHead(head.u);
  // 録っていない間（ホールド・フェード、録らない設定のソロ）は、録音ヘッドを淡くする
  drawHead(recX(), tk("tape.recHead"), recording());
  drawPanel();
}

// 録音ヘッドを通り過ぎたテープの位置に、前の周の分（1 周分小さくなる）と、今マイクから入った分を足して書く。
// テープに残っている一番大きな値を返す
function updateMicTrack(tape: number): number {
  const input = micOn() && recording() ? (micMeter.getValue() as number) : 0;
  const loss = held ? 1 : feedback.gain.value;
  const to = Math.floor(tape * MIC_BINS);
  const from = Math.max(Math.floor((lastTape ?? tape) * MIC_BINS), to - MIC_BINS);
  for (let i = from + 1; i <= to; i++) {
    const b = ((i % MIC_BINS) + MIC_BINS) % MIC_BINS;
    micTrack[b] = Math.min(1, micTrack[b] * loss + input);
    if (micTrack[b] < 0.001) micTrack[b] = 0;
  }
  lastTape = tape;
  let max = 0;
  for (const v of micTrack) max = Math.max(max, v);
  return max;
}

let last = performance.now();
let lastFrameTape: number | null = null;

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
  // 足した再生ヘッドを通った音も光らせる（その周の大きさで）
  if (lastFrameTape !== null) {
    for (const head of activeHeads()) {
      for (const m of marks) {
        const passed = Math.floor(tape - m.start - head.u) > Math.floor(lastFrameTape - m.start - head.u);
        if (!passed || tape - m.start < head.u) continue;
        glows.push({ x: xAt(head.u), y: yOf(m.freq, pitches), life: 1, strength: Math.min(1, m.level) * EXTRA_HEAD_LEVEL });
      }
    }
  }
  lastFrameTape = tape;
  const micLeft = updateMicTrack(tape);
  updateAuto(dt, tape);
  settleGlides();

  // フェードで消えきったら、元に戻す
  if (fading && marks.length === 0 && micLeft < SILENT_LEVEL) {
    fading = false;
    applyLoop();
  }

  for (const glow of glows) glow.life -= dt * 1.2;
  glows = glows.filter((glow) => glow.life > 0);

  draw(tape);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
