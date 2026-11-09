import * as Tone from "tone";
import "../ripples/style.css";
import { drawPitchGuides, pitchAt, pitchIndexAt, type Pitch } from "../scales";
import { setupCanvas, setupGenerativePage } from "../generative";
import { onLangChange, tk } from "../i18n";
import { setupLevel } from "../levels";
import { RECORD } from "../record";
import { addWorkletModule, workletsAvailable } from "../audio";
import { celloBassVoice, celloVoice, mellotronVoice, sawVoice, stringsVoice, type Voice } from "./voices";
import reverseProcessorUrl from "./reverse-processor.ts?worker&url";
import type { ReverseMessage } from "./reverse-processor";
import { RadioStream } from "../broadcast/stream";
import { findStations as searchRadio, reportClick, type Station } from "../broadcast/stations";
import speechProcessorUrl from "../broadcast/speech-processor.ts?worker&url";
import type { SpeechMessage } from "../broadcast/speech-processor";

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
  turns: number; // level に反映した周の数（start から数える。逆再生で裏返すと start が移るので、0 から数え直す）
  worn: number; // 録られてから回った周の数（傷みで色をあせさせる）
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
type Button = "solo" | "hold" | "fade" | "octave" | "reverse" | "mic" | "radio";
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
const PLAY_HEAD = 0.05; // 再生ヘッドの横位置（画面の幅に対する割合）
const PLAY_HEAD_MIN = 52; // 再生ヘッドの左に、少なくともこれだけ空ける (px)。音名を書く分
const REC_HEAD = 0.82; // 録音ヘッドの横位置
// 操作盤（録音ヘッドの右）に少なくともこれだけの幅を取る。狭い画面では、そのぶん録音ヘッドを左へ寄せる
const PANEL_GAP = 34; // 録音ヘッドと操作盤の間 (20) と、画面の右端との間 (14)
const BUTTON_MIN_WIDTH = 80; // ボタンの文字（「オクターブ ↑」など）が収まる幅
const FADERS_MIN_WIDTH = 62; // 横に 1 列に並べたボタンの左に、フェーダー 2 本を置く幅
const COMPACT_HEIGHT = 600; // これより低い画面（スマホを横にしたときなど）では、ボタンを右に 1 列に並べ、フェーダーに高さを全部使う
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
const WOW_BASE = 0.005; // 揺れを作る短い遅れ (秒)
const HISS = 0.25; // 100% で、1 周ごとに入れるノイズの大きさ（テープに載っている音に対して）。およそ -20 dB
// オクターブ: テープへ戻す途中で音程を 1 オクターブずらす。戻るたびにずれるので、1 周ごとに上がり（下がり）続ける。
// 音程をずらす仕組み（Tone.PitchShift）は、平均で窓の半分だけ遅れる。ずらさないときも同じだけ遅らせて、1 周の長さをそろえる
const PITCH_WINDOW = 0.1; // 音程をずらす窓 (秒)
// 再生ヘッドで読んでから戻すまでに足される遅れ (秒)。その分、テープの遅れを短くして 1 周の長さを保つ
const LOOP_AFTER = WOW_BASE + PITCH_WINDOW / 2;
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
const radioLevelEl = document.querySelector<HTMLInputElement>("#radio-level")!;
const radioLevelValueEl = document.querySelector<HTMLOutputElement>("#radio-level-value")!;
const radioNextEl = document.querySelector<HTMLButtonElement>("#radio-next")!;
const radioStatusEl = document.querySelector<HTMLElement>("#radio-status")!;
const radioSpeechEl = document.querySelector<HTMLInputElement>("#radio-speech")!;
const radioSkipMusicEl = document.querySelector<HTMLInputElement>("#radio-skip-music")!;
const radioSkipPoliticsEl = document.querySelector<HTMLInputElement>("#radio-skip-politics")!;
const radioSkipReligionEl = document.querySelector<HTMLInputElement>("#radio-skip-religion")!;
const radioFragmentsEl = document.querySelector<HTMLInputElement>("#radio-fragments")!;
const radioFragmentLengthEl = document.querySelector<HTMLInputElement>("#radio-fragment-length")!;
const radioFragmentLengthValueEl = document.querySelector<HTMLOutputElement>("#radio-fragment-length-value")!;
const radioFragmentGapEl = document.querySelector<HTMLInputElement>("#radio-fragment-gap")!;
const radioFragmentGapValueEl = document.querySelector<HTMLOutputElement>("#radio-fragment-gap-value")!;
const autoEl = document.querySelector<HTMLInputElement>("#auto")!;
const wearEl = document.querySelector<HTMLInputElement>("#tape-wear")!;
const wearValueEl = document.querySelector<HTMLOutputElement>("#tape-wear-value")!;
const mellotronLimitEl = document.querySelector<HTMLInputElement>("#mellotron-limit")!;
const soloRecordEl = document.querySelector<HTMLInputElement>("#solo-record")!;
const extraHeadsEl = document.querySelector<HTMLInputElement>("#extra-heads")!;
const extraHeadsValueEl = document.querySelector<HTMLOutputElement>("#extra-heads-value")!;

// 1 周の長さ (秒)。スライダーは対数の目盛りで、短いほうを細かく動かせる
const LENGTH_MIN = 3;
const LENGTH_MAX = 90;
const loopSeconds = () => LENGTH_MIN * (LENGTH_MAX / LENGTH_MIN) ** Number(lengthEl.value);
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
// オクターブ: 1 で上へ、-1 で下へ、1 周ごとにずらす。0 でずらさない。ホールド中はずらさない（中身をそのまま回し続ける）
let octave: -1 | 0 | 1 = 0;
// 逆再生: 区切り（anchor + 整数 周）ごとに、直前の 1 周を裏返して鳴らす。
// 止めるときは、今の 1 周の終わり（until）まで続ける（途中で止めると、裏返した音と画面の印がずれる）
let reverse: { anchor: number; until: number | null } | null = null;
const REVERSE_LEAD = 0.05; // 逆再生を始めるまでの間 (秒)。AudioWorklet に区切りが届くのを待つ
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
const tapeDelay = new Tone.Delay({ delayTime: loopSeconds() - LOOP_AFTER, maxDelay: LENGTH_MAX + 1 });
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

// 逆再生。テープの遅れ（順向き）と、逆向きに読む AudioWorklet を、切り替えて使う。
// AudioWorklet のモジュールは非同期に読み込むので、届いてからつなぐ
const forward = new Tone.Gain(1);
const backward = new Tone.Gain(0);
tapeDelay.connect(forward);
forward.connect(wobble);
backward.connect(wobble);
// AudioWorklet が使えないとき（LAN の http の開発サーバー）は、逆再生を使えなくする（toggle）
const reverseNode = addWorkletModule(reverseProcessorUrl).then(() => {
  const node = Tone.getContext().createAudioWorkletNode("tape-reverse", {
    channelCount: 1,
    channelCountMode: "explicit",
    outputChannelCount: [1],
  });
  Tone.connect(writeBus, node);
  Tone.connect(node, backward);
  return node;
});
reverseNode.catch(() => {});

// オクターブ。ずらした音（octaveWet）と、同じだけ遅らせた元の音（octaveDry）を切り替える
const pitchShift = new Tone.PitchShift({ pitch: 12, windowSize: PITCH_WINDOW, wet: 1 });
const octaveDelay = new Tone.Delay(PITCH_WINDOW / 2);
const octaveWet = new Tone.Gain(0);
const octaveDry = new Tone.Gain(1);
pitchShift.chain(octaveWet, saturateIn);
octaveDelay.chain(octaveDry, saturateIn);

wobble.chain(wearLowpass, loopLowpass, loopHighpass);
Tone.connect(loopHighpass, pitchShift);
Tone.connect(loopHighpass, octaveDelay);
saturateIn.chain(saturate, saturateOut);
saturateOut.connect(feedback);
feedback.connect(writeBus);
Tone.connect(loopHighpass, follower); // ノイズを入れる前の大きさを見る
saturateOut.connect(tapeOut);

// 足す再生ヘッド。書いた音を u 周分遅らせて鳴らす。使わないヘッドは絞っておく
const extraHeads = EXTRA_HEADS.map((u) => {
  const delay = new Tone.Delay({ delayTime: u * loopSeconds(), maxDelay: LENGTH_MAX + 1 });
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
  if (timbreEl.value === "mellotron") return mellotronVoice(mellotronLimitEl.checked, [clean, distortion]);
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

// --- ラジオ ---

// 世界のインターネットラジオ（Radio Browser に登録された局）を、マイクと同じようにテープにだけ録る
// （ジョン・ケージ『Imaginary Landscape No. 4』、イーノとバーン『My Life in the Bush of Ghosts』）。
// 局はランダムに選び、ブラウザから音を取り出せない局（CORS で許されていない、https でない、HLS）は飛ばして次を試す。
// 局を探している間は、ダイヤルを回すような雑音を鳴らす（これもテープに録る）。
// 放送は鳴り続けるので、マイクと違って自動は休ませない。
// 設定で、話の多い局（news / talk などのタグ）だけを選ぶ、政治色の強い局を除く、音楽ならほかの局へ、を選べる
const RADIO_WAIT = 8000; // 1 局の音が出るまで待つ時間 (ミリ秒)
const RADIO_TRIES = 12; // 1 回の選局で試す局の数
// 音楽を見分けるため、放送を遅らせてからテープに送る。その音を含む判断が出そろってから録るかを決める
const RADIO_DELAY = 4;
const SPEECH_AVERAGE = 5; // 0.5 秒ごとに届く話し声らしさを、これだけ平均して使う
const SPEECH_OPEN = 0.7; // 平均がこれを超えたら話し声として録り始め、
const SPEECH_CLOSE = 0.4; // これを下回ったら音楽として、ほかの局へ（間の値では今の状態を保つ）
const UNSURE_SWITCH = 20; // 話し声と分からないまま（無音や、どちらとも言えない音）これだけ過ぎたら、ほかの局へ (秒)
// 断片で録る: 放送を流し続けて録るのでなく、短い断片を間を空けて録り、何個か録ったら局を変える。
// 断片はテープのあちこちに散らばり、局も変わっていくので、同じ並びは二度と現れない
const FRAGMENT_SPREAD = [0.5, 1.5]; // 断片の長さと間は、設定の値にこの範囲の倍率をかける
// 断片の後の間は、録った断片の長さに、設定の「断片の間」（倍率）をかける
const FRAGMENTS_PER_STATION = [1, 3]; // 1 局で録る断片の数（この範囲で選ぶ）
const FRAGMENT_EDGE = 0.04; // 断片の頭と終わりのフェード (秒)
const between = ([low, high]: number[]) => low + Math.random() * (high - low);

const radioIn = new Tone.Gain(Number(radioLevelEl.value) / 100);
const radioDelay = new Tone.Delay(RADIO_DELAY, RADIO_DELAY);
const musicGate = new Tone.Gain(1); // 音楽の間は閉じる
const fragmentGate = new Tone.Gain(radioFragmentsEl.checked ? 0 : 1); // 断片で録るとき、断片の間だけ開く
radioDelay.chain(musicGate, fragmentGate, radioIn);
const radioCompressor = new Tone.Compressor({ threshold: -24, ratio: 4 });
const radioHighpass = new Tone.Filter({ type: "highpass", frequency: 120 });
const radioMeter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
radioIn.chain(radioCompressor, radioHighpass, recordGate);
radioHighpass.connect(radioMeter);

// 選局の雑音。帯域を絞ったノイズの中心を、ダイヤルを回すように揺らす
const tuneNoise = new Tone.Noise("pink");
const tuneFilter = new Tone.Filter({ type: "bandpass", frequency: 1200, Q: 3 });
const tuneSweep = new Tone.LFO({ frequency: 0.6, min: 300, max: 3000 });
const tuneLevel = new Tone.Gain(0);
tuneSweep.connect(tuneFilter.frequency);
tuneNoise.chain(tuneFilter, tuneLevel, radioIn);
// 断片で録るときは、選局の雑音は録らない（断片の間を空けておく）
function showTuneNoise(on: boolean) {
  if (radioFragmentsEl.checked) on = false;
  if (on && tuneNoise.state !== "started") {
    tuneNoise.start();
    tuneSweep.start();
  }
  tuneLevel.gain.rampTo(on ? 0.3 : 0, on ? 0.1 : 0.4);
}

// 放送は fetch で受け取り、ページの中で音に戻す（<audio> では iPhone で Web Audio に取り出せないため。radio-stream.ts）
const radioStream = new RadioStream();
radioStream.output.connect(radioDelay);
let radioOn = false;
let radioSearching = false;
let radioQueue: Station[] = [];
let tuning = 0; // 選局の番号。新しく選局を始めたら、前の選局は途中でやめる
let radioStatus: string | null = null; // 表示している文言のキー（局の名前を出しているときは null）

function showRadioStatus(key: string | null, station?: Station) {
  radioStatus = key;
  const name = station ? `📻 ${station.name.trim()} · ${station.countrycode}` : "";
  radioStatusEl.textContent = [name, key ? tk(key) : ""].filter(Boolean).join(" · ");
}
onLangChange(() => {
  if (radioStatus) showRadioStatus(radioStatus, radioStation ?? undefined);
});

const findStations = () =>
  searchRadio({
    kind: radioSpeechEl.checked ? "talk" : "all",
    skipPolitics: radioSkipPoliticsEl.checked,
    skipReligion: radioSkipReligionEl.checked,
  });

// 音楽を見分ける。放送を受けたらすぐ（遅らせる前の音で）判断する
let radioStation: Station | null = null;
let stationCount = 0; // つながった局の数（色を順番に変えるため）
let radioColor = 0; // 今の局の色の番号
let stationSince = 0; // 今の局につながった時刻 (AudioContext の秒)
let hearingSpeech = false; // 今、話し声として録っているか
let unsureSince: number | null = null; // 話し声と分からないまま待ち始めた時刻
let speechHistory: number[] = []; // 最近の話し声らしさ
const speechNode = addWorkletModule(speechProcessorUrl).then(() => {
  const node = Tone.getContext().createAudioWorkletNode("speech-detector", {
    channelCount: 1,
    channelCountMode: "explicit",
    numberOfOutputs: 0,
  });
  node.port.onmessage = (e: MessageEvent<SpeechMessage>) => hearSpeech(e.data.speech);
  Tone.connect(radioStream.output, node);
  return node;
});
speechNode.catch(() => {});
// 聞き分けられないときは、「音楽ならほかの局へ」を使えなくする（オンのままだと、話し声と分からないので何も録らない）
if (!workletsAvailable()) {
  radioSkipMusicEl.checked = false;
  radioSkipMusicEl.disabled = true;
}

function hearSpeech(speech: number | null) {
  if (!radioOn || radioSearching) return;
  if (!radioSkipMusicEl.checked) return;
  if (speech !== null) {
    speechHistory.push(speech);
    if (speechHistory.length > SPEECH_AVERAGE) speechHistory.shift();
    const average = speechHistory.reduce((sum, a) => sum + a, 0) / speechHistory.length;
    // 音楽と分かったら、すぐほかの局を探す（遅らせている分の音楽は録らない）
    if (speechHistory.length >= SPEECH_AVERAGE && average < SPEECH_CLOSE) {
      void tune("radioStatus.skipMusic");
      return;
    }
    if (!hearingSpeech && average > SPEECH_OPEN) hearingSpeech = true;
  }
  applyMusicGate();
  const now = performance.now() / 1000;
  if (!hearingSpeech) {
    unsureSince ??= now;
    if (now - unsureSince > UNSURE_SWITCH) void tune();
  } else unsureSince = null;
}

// 音楽ならほかの局へ、の設定では、話し声と分かるまで録らずに聞き分ける
const musicOpen = () => !radioSkipMusicEl.checked || (hearingSpeech && !radioSearching);
function applyMusicGate() {
  musicGate.gain.setTargetAtTime(musicOpen() ? 1 : 0, Tone.now(), 0.05);
  showStationStatus();
}

// 局が鳴っているときの表示。聞き分けている間、断片を録っている間はそう出す
function showStationStatus() {
  if (!radioStation || radioSearching) return;
  const key = !musicOpen() ? "radioStatus.listening" : fragmentRecording ? "radioStatus.fragment" : null;
  showRadioStatus(key, radioStation);
}

// 断片で録る
let fragmentTimer: ReturnType<typeof setTimeout> | null = null;
let fragmentRecording = false;
let fragmentsLeft = 0; // この局で、あと何個録るか

function waitFragment(seconds: number) {
  if (fragmentTimer) clearTimeout(fragmentTimer);
  fragmentTimer = setTimeout(recordFragment, seconds * 1000);
}

function recordFragment() {
  fragmentTimer = null;
  if (!radioOn || !radioFragmentsEl.checked) return;
  // 局を探している間や、話し声と分かるまで、遅らせている分の音がこの局になるまでは待つ
  if (radioSearching || !radioStation || !musicOpen() || Tone.now() - stationSince < RADIO_DELAY) {
    waitFragment(0.5);
    return;
  }
  const length = Number(radioFragmentLengthEl.value) * between(FRAGMENT_SPREAD);
  const now = Tone.now();
  fragmentGate.gain.cancelScheduledValues(now).setValueAtTime(0, now).linearRampToValueAtTime(1, now + FRAGMENT_EDGE);
  fragmentGate.gain.setValueAtTime(1, now + length - FRAGMENT_EDGE).linearRampToValueAtTime(0, now + length);
  fragmentRecording = true;
  showStationStatus();
  fragmentTimer = setTimeout(() => {
    fragmentTimer = null;
    fragmentRecording = false;
    showStationStatus();
    if (!radioOn || !radioFragmentsEl.checked) return;
    if (--fragmentsLeft <= 0) void tune();
    waitFragment(length * Number(radioFragmentGapEl.value) * between(FRAGMENT_SPREAD));
  }, length * 1000);
}

function stopFragments() {
  if (fragmentTimer) clearTimeout(fragmentTimer);
  fragmentTimer = null;
  fragmentRecording = false;
  const now = Tone.now();
  fragmentGate.gain.cancelScheduledValues(now).setTargetAtTime(radioFragmentsEl.checked ? 0 : 1, now, 0.02);
}

// 局の音が出始めたら true、出せなかったら（CORS で断られた、形式が違う、時間切れなど）false。
// 放送が途切れたら、別の局を探す
function playStation(station: Station): Promise<boolean> {
  return radioStream.play(station.url_resolved, RADIO_WAIT, () => {
    if (radioOn && !radioSearching) void tune();
  });
}

async function tune(searchingStatus = "radioStatus.searching") {
  const id = ++tuning;
  radioOn = true;
  radioSearching = true;
  hearingSpeech = false;
  applyMusicGate(); // 遅らせている前の局の音を、聞き分けないまま録らない
  radioStation = null;
  showRadioStatus(searchingStatus);
  showTuneNoise(true);
  for (let tries = 0; tries < RADIO_TRIES; tries++) {
    if (radioQueue.length === 0) {
      try {
        radioQueue = await findStations();
      } catch (e) {
        console.warn(e);
        break;
      }
      if (id !== tuning) return;
      if (radioQueue.length === 0) break;
    }
    const station = radioQueue.shift()!;
    const ok = await playStation(station);
    if (id !== tuning) return;
    if (!ok) continue;
    radioSearching = false;
    showTuneNoise(false);
    radioStation = station;
    radioColor = stationCount++ % STATION_COLORS;
    stationSince = Tone.now();
    unsureSince = null;
    speechHistory = [];
    fragmentsLeft = Math.round(between([FRAGMENTS_PER_STATION[0] - 0.49, FRAGMENTS_PER_STATION[1] + 0.49]));
    if (radioFragmentsEl.checked && !fragmentTimer) waitFragment(0.5);
    speechNode.then((node) => node.port.postMessage("reset"), () => {});
    applyMusicGate();
    reportClick(station);
    return;
  }
  if (id !== tuning) return;
  stopRadio();
  showRadioStatus("radioStatus.failed");
}

function stopRadio() {
  tuning++;
  radioOn = false;
  radioSearching = false;
  radioStream.stop();
  showTuneNoise(false);
  stopFragments();
  radioStation = null;
  showRadioStatus(null);
}

radioNextEl.addEventListener("click", async () => {
  await page.ensureStarted();
  void tune();
});

const showRadioLevel = () => (radioLevelValueEl.value = `${radioLevelEl.value}%`);
radioLevelEl.addEventListener("input", () => {
  showRadioLevel();
  radioIn.gain.rampTo(Number(radioLevelEl.value) / 100, 0.05);
});
showRadioLevel();
// 局の選び方を変えたら、次の選局から新しい条件で探す
for (const el of [radioSpeechEl, radioSkipPoliticsEl, radioSkipReligionEl]) el.addEventListener("change", () => (radioQueue = []));
radioFragmentsEl.addEventListener("change", () => {
  stopFragments();
  if (radioOn && radioSearching) showTuneNoise(true);
  if (radioOn && radioFragmentsEl.checked) waitFragment(0.5);
  showStationStatus();
});
const showFragmentLength = () => (radioFragmentLengthValueEl.value = `${radioFragmentLengthEl.value} s`);
radioFragmentLengthEl.addEventListener("input", showFragmentLength);
showFragmentLength();
const showFragmentGap = () => (radioFragmentGapValueEl.value = `×${radioFragmentGapEl.value}`);
radioFragmentGapEl.addEventListener("input", showFragmentGap);
showFragmentGap();
radioSkipMusicEl.addEventListener("change", () => {
  unsureSince = null;
  speechHistory = [];
  if (radioOn && !radioSearching) applyMusicGate();
});
micIn.gain.value = Number(micLevelEl.value) / 100;

// 天気: 空模様でテープが削る高さ（晴れで明るく、雨でこもる）、雲でリバーブが変わる。
// 変化: 天気で決まった値を中心に、音域・テープの明るさ・リバーブがゆっくり揺れ、20 分ごとに 5 度上へ転調する
let lowpass = LOOP_LOWPASS;
const wearCutoff = (w = wear()) => 20000 * 2 ** (-WEAR_DARKEN * w);
const page = setupGenerativePage({
  defaults: { scale: "major-pentatonic", root: "A" },
  // ▶ で、自動（オンのとき）をすぐ始める。ラジオは一時停止のあいだ受信を止め、再開したら局を探し直す
  // （止めたまま受け取ると、届いた放送がたまって、再開したときに遅れて鳴る）
  onPlay: () => {
    idle = IDLE_BEFORE_AUTO;
    untilAuto = 0;
    if (radioOn) void tune();
  },
  onPause: () => {
    if (!radioOn) return;
    tuning++;
    radioStream.stop();
    stopFragments();
  },
  reverb: { node: reverb, wet: 0.35, decay: 6 },
  // テープの音の音域は Tape だけのもの（はじめは低く。ソロの音域と同じく、ほかのページとは引き継がない）
  register: { param: "tape-register", initial: 1 },
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
const timeAt = (turns: number) => clock.time + (turns - clock.turns) * clock.seconds;

// 逆再生の区切りを AudioWorklet に知らせ、順向き・逆向きの切り替えを予約する。
// 逆向きに読む区切りは、再生ヘッドの後ろで足される遅れの半分だけ早める（裏返した音が、ちょうど区切りを鏡にした時刻に鳴る）
function scheduleReverse() {
  if (!reverse) return;
  const early = LOOP_AFTER / 2;
  const message: ReverseMessage = { start: timeAt(reverse.anchor) - early, length: clock.seconds };
  reverseNode.then((node) => node.port.postMessage(message), () => {});
  const now = Tone.immediate();
  forward.gain.cancelScheduledValues(now);
  backward.gain.cancelScheduledValues(now);
  const on = Math.max(timeAt(reverse.anchor) - early, now);
  forward.gain.setTargetAtTime(0, on, 0.003);
  backward.gain.setTargetAtTime(1, on, 0.003);
  if (reverse.until === null) return;
  const off = Math.max(timeAt(reverse.until) - early, now);
  forward.gain.setTargetAtTime(1, off, 0.003);
  backward.gain.setTargetAtTime(0, off, 0.003);
}

const showLength = () => (lengthValueEl.value = `${loopSeconds().toFixed(loopSeconds() < 10 ? 2 : 1)} s`);
lengthEl.addEventListener("input", () => {
  showLength();
  const now = Tone.immediate();
  clock = { time: now, turns: tapeAt(now), seconds: loopSeconds() };
  tapeDelay.delayTime.rampTo(loopSeconds() - LOOP_AFTER, LENGTH_RAMP, now);
  for (const head of extraHeads) head.delay.delayTime.rampTo(head.u * loopSeconds(), LENGTH_RAMP, now);
  if (reverse) scheduleReverse();
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
const playX = () => Math.max(PLAY_HEAD_MIN, width * PLAY_HEAD);
const compact = () => height < COMPACT_HEIGHT;
const panelMinWidth = () => (compact() ? BUTTON_MIN_WIDTH + 8 + FADERS_MIN_WIDTH : BUTTON_MIN_WIDTH + 4);
// 録音モード（投稿用の動画）では操作盤を描かないので、録音ヘッドを右端から再生ヘッドと同じだけ離して置く
const recX = () => (RECORD ? width - playX() : Math.min(width * REC_HEAD, width - PANEL_GAP - panelMinWidth()));
const hintEl = document.querySelector<HTMLElement>("#hint")!;
const barEl = document.querySelector<HTMLElement>(".bar")!;
const g = setupCanvas(canvas, (w, h) => {
  width = w;
  height = h;
  // 開始時の案内は、再生ヘッドと録音ヘッドの間に収める（右の操作盤や左の音名に重ならないように）
  hintEl.style.left = `${playX()}px`;
  hintEl.style.right = `${width - recX()}px`;
});
let marks: Mark[] = [];
let glows: Glow[] = [];
const touches = new Map<number, Touch>();
// テープの位置ごとの、マイクの音の大きさ。添え字は 1 周の中の位置
const micTrack = new Float32Array(MIC_BINS);
// その位置にいちばん大きく書いた音の色。マイク、選局の雑音、ラジオの局ごとの色の番号
const SOURCE_MIC = -1;
const SOURCE_TUNING = -2;
const trackSource = new Int8Array(MIC_BINS).fill(SOURCE_MIC);
// ラジオの局の色。つながるたびに順番に変える。色相を 157.5° ずつ回すと、隣の局と大きく違い、16 色すべてが一度ずつ出る
const STATION_COLORS = 16;
const stationHue = (n: number) => (200 + n * 157.5) % 360; // 最初の局は青から（マイクの橙と分けるため）
let lastTape: number | null = null;


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
  const mark: Mark = { part, freq, start: tapeAt(time), end: null, level: 1, turns: 0, worn: 0, bends: [] };
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
  const shift = held ? 0 : octave;
  if (shift !== 0) pitchShift.pitch = 12 * shift;
  octaveWet.gain.setTargetAtTime(shift !== 0 ? 1 : 0, now, 0.02);
  octaveDry.gain.setTargetAtTime(shift !== 0 ? 0 : 1, now, 0.02);
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

// 残り方を手で動かしたら、ホールドとフェードを解いて、手の値にする（どちらの間も残り方は自動で決まり、動かしても効かないため）
feedbackEl.addEventListener("input", () => {
  feedbackValueEl.value = `${feedbackEl.value}%`;
  held = false;
  fading = false;
  applyLoop();
});
feedbackValueEl.value = `${feedbackEl.value}%`;

function toggle(button: Button) {
  if (button === "solo") soloLatched = !soloLatched;
  if (button === "hold") {
    held = !held;
    fading = false;
  }
  if (button === "radio") {
    if (radioOn) stopRadio();
    else void tune();
  }
  if (button === "mic") {
    if (micOn()) closeMic();
    else if (!micOpening) void openMic();
  }
  if (button === "octave") octave = octave === 0 ? 1 : octave === 1 ? -1 : 0;
  if (button === "reverse") {
    if (!workletsAvailable()) return; // 逆向きに読む AudioWorklet がないと、テープが鳴らなくなる
    const now = Tone.immediate();
    if (!reverse) reverse = { anchor: tapeAt(now + REVERSE_LEAD), until: null };
    else if (reverse.until === null) reverse.until = reverse.anchor + Math.max(1, Math.floor(tapeAt(now) - reverse.anchor) + 1);
    else reverse.until = null;
    scheduleReverse();
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
  if (!page.playing() || !autoEl.checked || !recording() || solo() || clearing || idle < IDLE_BEFORE_AUTO) return;
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

// 行ごとのボタン。オクターブと逆再生、マイクとラジオは 1 行に並べる
const BUTTON_ROWS: Button[][] = [["solo"], ["hold"], ["fade"], ["octave", "reverse"], ["mic", "radio"]];
const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 8;

const BUTTON_ORDER = BUTTON_ROWS.flat();

// 操作盤の配置。ボタンは下に縦に並べ、フェーダーはその上の残りを使う
function panel() {
  const left = recX() + 20;
  const right = width - 14;
  // 上のメニューの下から始める（狭い画面ではメニューが 2 段に折り返す）。フェーダーの上には名前を書く分を空ける
  const barBottom = barEl.getBoundingClientRect().bottom;
  const top = Math.max(96, barBottom + 34);
  if (compact()) {
    const w = Math.max(BUTTON_MIN_WIDTH, (right - left) * 0.5);
    const x = right - w;
    const bottom = height - 20;
    const n = BUTTON_ORDER.length;
    const buttonsTop = Math.max(barBottom + 10, bottom - n * BUTTON_HEIGHT - (n - 1) * BUTTON_GAP);
    const h = Math.min(BUTTON_HEIGHT, (bottom - buttonsTop - (n - 1) * BUTTON_GAP) / n);
    const buttons = BUTTON_ORDER.map((id, i) => ({ id, x, y: buttonsTop + i * (h + BUTTON_GAP), w, h }));
    const area = x - 8 - left; // フェーダーを置く幅
    const faderBottom = height - 56; // 下に値を書く分（狭いと 1 行ずらす）を空ける
    const faders: Record<Fader, { x: number; top: number; bottom: number }> = {
      feedback: { x: left + area * 0.25, top, bottom: faderBottom },
      length: { x: left + area * 0.75, top, bottom: faderBottom },
    };
    return { left, right: x - 8, buttons, faders };
  }
  const bottom = height - 44;
  // 2 つ並べるとボタンの文字が収まらない幅なら（縦向きのスマホなど）、全部 1 列に並べる
  const buttonRows = right - left < BUTTON_MIN_WIDTH * 2 + BUTTON_GAP ? BUTTON_ORDER.map((id) => [id]) : BUTTON_ROWS;
  const rows = buttonRows.length;
  const buttonsTop = bottom - rows * BUTTON_HEIGHT - (rows - 1) * BUTTON_GAP;
  const buttons = buttonRows.flatMap((row, i) => {
    const w = (right - left - (row.length - 1) * BUTTON_GAP) / row.length;
    return row.map((id, j) => ({
      id,
      x: left + j * (w + BUTTON_GAP),
      y: buttonsTop + i * (BUTTON_HEIGHT + BUTTON_GAP),
      w,
      h: BUTTON_HEIGHT,
    }));
  });
  // フェーダーは左に残り方、右に 1 周の長さ
  const faderBottom = buttonsTop - 40;
  const faders: Record<Fader, { x: number; top: number; bottom: number }> = {
    feedback: { x: left + (right - left) * 0.28, top, bottom: faderBottom },
    length: { x: left + (right - left) * 0.72, top, bottom: faderBottom },
  };
  return { left, right, buttons, faders };
}

const inPanel = (x: number) => x > panel().left - 8;

type Fader = "feedback" | "length";
const faderPointers = new Map<number, Fader>();
function setFaderFrom(which: Fader, y: number) {
  const fader = panel().faders[which];
  const ratio = Math.min(Math.max((fader.bottom - y) / (fader.bottom - fader.top), 0), 1);
  // 設定のスライダーを動かしたのと同じにする（長さは対数の目盛りのまま）
  const el = which === "feedback" ? feedbackEl : lengthEl;
  el.value = which === "feedback" ? String(Math.round(ratio * MAX_FEEDBACK)) : String(ratio);
  el.dispatchEvent(new Event("input"));
}

function pressPanel(e: PointerEvent) {
  const hit = panel().buttons.find(
    (b) => e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h,
  );
  if (hit) {
    toggle(hit.id);
    return;
  }
  // フェーダーの範囲（right はフェーダーを置く幅の右端）。近いほうのフェーダーを動かす
  const { right, faders } = panel();
  if (e.clientY < faders.feedback.bottom + 24 && e.clientX <= right) {
    const which: Fader = e.clientX < (faders.feedback.x + faders.length.x) / 2 ? "feedback" : "length";
    faderPointers.set(e.pointerId, which);
    setFaderFrom(which, e.clientY);
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
  const fader = faderPointers.get(e.pointerId);
  if (fader) {
    setFaderFrom(fader, e.clientY);
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
  if (e.key === "o" || e.key === "O") toggle("octave");
  if (e.key === "r" || e.key === "R") toggle("reverse");
  if (e.key === "t" || e.key === "T") toggle("radio");
  if ((e.key === "n" || e.key === "N") && radioOn) void tune();
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
  for (const m of marks) Object.assign(m, { start: tapeAt(now), level: 1, turns: 0, worn: 0, bends: [] });
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
  const fade = Math.min(0.8, m.worn * wear() * 0.15);

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
    const alpha = 0.04 + 0.16 * level;
    const source = trackSource[b];
    g.fillStyle =
      source === SOURCE_MIC
        ? `rgba(255, 196, 140, ${alpha})`
        : source === SOURCE_TUNING
          ? `rgba(200, 200, 208, ${alpha})`
          : `hsla(${stationHue(source)}, 85%, 72%, ${alpha * 1.4})`;
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

// shift: 名前と値を、何行ずらすか（スマホのように操作盤が狭く、隣のフェーダーの文字と重なるとき）
function drawFader(fader: { x: number; top: number; bottom: number }, ratio: number, label: string, value: string, bright: boolean, shift = 0) {
  const knobY = fader.bottom - Math.min(Math.max(ratio, 0), 1) * (fader.bottom - fader.top);
  g.fillStyle = "rgba(232, 232, 236, 0.5)";
  g.fillText(label, fader.x, fader.top - 14 - shift * 14);
  g.fillStyle = "rgba(255, 255, 255, 0.08)";
  g.fillRect(fader.x - 3, fader.top, 6, fader.bottom - fader.top);
  g.fillStyle = bright ? "rgba(108, 196, 255, 0.9)" : "rgba(108, 196, 255, 0.5)";
  g.fillRect(fader.x - 3, knobY, 6, fader.bottom - knobY);
  g.fillStyle = "#e8e8ec";
  g.beginPath();
  g.arc(fader.x, knobY, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(232, 232, 236, 0.7)";
  g.fillText(value, fader.x, fader.bottom + 22 + shift * 14);
}

function drawPanel() {
  const { buttons, faders } = panel();
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "center";
  drawFader(
    faders.feedback,
    held ? 1 : feedback.gain.value / (MAX_FEEDBACK / 100),
    tk("tapeFeedback"),
    held ? "∞" : `${Math.round(feedback.gain.value * 100)}%`,
    held,
  );
  const seconds = loopSeconds();
  const crowded = faders.length.x - faders.feedback.x < 60;
  drawFader(faders.length, Number(lengthEl.value), tk("tape.lengthFader"), `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`, false, crowded ? 1 : 0);

  const on: Record<Button, boolean> = {
    solo: solo(),
    hold: held,
    fade: fading,
    octave: octave !== 0,
    reverse: reverse !== null && reverse.until === null,
    mic: micOn(),
    radio: radioOn,
  };
  // 止めるのを待っている逆再生は、枠だけ光らせる
  const pending = reverse?.until != null;
  const label = (id: Button) => tk(`tape.${id}`) + (id === "octave" && octave !== 0 ? (octave > 0 ? " ↑" : " ↓") : "");
  g.font = "12px system-ui, sans-serif";
  for (const b of buttons) {
    g.fillStyle = on[b.id] ? "rgba(108, 196, 255, 0.18)" : "rgba(35, 37, 45, 0.9)";
    g.strokeStyle = on[b.id] || (b.id === "reverse" && pending) ? "#6cc4ff" : "#3a3d48";
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, 6);
    g.fill();
    g.stroke();
    g.fillStyle = on[b.id] ? "#6cc4ff" : "#e8e8ec";
    g.fillText(label(b.id), b.x + b.w / 2, b.y + b.h / 2 + 4);
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
  if (!RECORD) drawPanel();
}

// 録音ヘッドを通り過ぎたテープの位置に、前の周の分（1 周分小さくなる）と、今マイクから入った分を足して書く。
// テープに残っている一番大きな値を返す
function updateMicTrack(tape: number): number {
  const micLevel = micOn() ? (micMeter.getValue() as number) : 0;
  const radioLevel = radioOn ? (radioMeter.getValue() as number) : 0;
  const input = recording() ? micLevel + radioLevel : 0;
  // 大きいほうの色で書く
  const source = radioLevel > micLevel ? (radioStation ? radioColor : SOURCE_TUNING) : SOURCE_MIC;
  const loss = held ? 1 : feedback.gain.value;
  const to = Math.floor(tape * MIC_BINS);
  const from = Math.max(Math.floor((lastTape ?? tape) * MIC_BINS), to - MIC_BINS);
  for (let i = from + 1; i <= to; i++) {
    const b = ((i % MIC_BINS) + MIC_BINS) % MIC_BINS;
    const kept = micTrack[b] * loss;
    if (input > kept && input > 0.001) trackSource[b] = source;
    micTrack[b] = Math.min(1, kept + input);
    if (micTrack[b] < 0.001) micTrack[b] = 0;
  }
  lastTape = tape;
  let max = 0;
  for (const v of micTrack) max = Math.max(max, v);
  return max;
}

// 再生ヘッドを過ぎた音は、1 周分小さくなって録音ヘッドから出てくる。オクターブ中は、1 周ごとに音程もずれる
function advanceMarks(tape: number, pitches: Pitch[]) {
  const shift = held ? 0 : octave;
  for (const m of marks) {
    const turns = Math.floor(tape - m.start);
    if (turns <= m.turns) continue;
    glows.push({ x: playX(), y: yOf(m.freq, pitches), life: 1, strength: Math.min(1, m.level) });
    m.level *= turnLoss(m.freq) ** (turns - m.turns);
    if (shift !== 0) {
      const ratio = 2 ** (shift * (turns - m.turns));
      m.freq *= ratio;
      for (const b of m.bends) b.freq *= ratio;
    }
    m.worn += turns - m.turns;
    m.turns = turns;
  }
}

// 音の頭から offset (周) のところの音程
function freqAt(m: Mark, offset: number): number {
  let freq = m.freq;
  for (const b of m.bends) if (b.at - m.start <= offset) freq = b.freq;
  return freq;
}

// 逆再生の区切り turn (周) で、テープの上の音を裏返す。区切りの直前の 1 周に録られた分が、区切りを鏡にした位置へ移り、
// 終わりの方から鳴る。区切りをまたいで録っている途中の音（押している音、自動で弾いている音）は、区切りから先を新しい音として分ける。
// 区切りをまたいで再生している途中の音は、区切りから先が録り直されないので、そこで切れる
function flipMarks(turn: number) {
  const rests: Mark[] = [];
  for (const m of marks) {
    if (m.start >= turn) continue;
    const k = Math.ceil(turn - m.start) - 1; // 区切りの直前の 1 周にある、何周目の録音か
    const copy = m.start + k;
    const whole = (m.end ?? Infinity) - m.start;
    const length = Math.min(whole, turn - copy);
    if (k === 0 && whole > length) {
      const rest: Mark = {
        part: m.part,
        freq: freqAt(m, turn - m.start),
        start: turn,
        end: m.end,
        level: 1,
        turns: 0,
        worn: 0,
        bends: m.bends.filter((b) => b.at > turn),
      };
      rests.push(rest);
      for (const touch of touches.values()) if (touch.mark === m) touch.mark = rest;
    }
    // 音程の点（音の頭からの距離と周波数）を、終わりから並べ直す
    const points = [{ offset: 0, freq: m.freq }];
    for (const b of m.bends) if (b.at - m.start < length) points.push({ offset: b.at - m.start, freq: b.freq });
    const start = 2 * turn - (copy + length) - 1;
    m.freq = points[points.length - 1].freq;
    m.bends = points.length > 1 ? points.reverse().map((p) => ({ at: start + length - p.offset, freq: p.freq })) : [];
    m.start = start;
    m.end = start + length;
    m.turns = 0;
  }
  marks.push(...rests);

  // マイクの音も、同じように鏡にした位置へ移す
  const before = micTrack.slice();
  const beforeSource = trackSource.slice();
  const pivot = Math.round(2 * turn * MIC_BINS);
  for (let b = 0; b < MIC_BINS; b++) {
    const to = (((pivot - b - 1) % MIC_BINS) + MIC_BINS) % MIC_BINS;
    micTrack[to] = before[b];
    trackSource[to] = beforeSource[b];
  }
}

let last = performance.now();
let lastFrameTape: number | null = null;

function frame(t: number) {
  const dt = Math.min((t - last) / 1000, 0.05);
  last = t;
  const tape = tapeAt(Tone.immediate());
  const pitches = page.pitches();

  // 逆再生の区切りを過ぎたら、そこまで進めてから裏返す。止める区切りでは、裏返さずに終える
  if (reverse && lastFrameTape !== null) {
    for (let n = Math.max(0, Math.floor(lastFrameTape - reverse.anchor) + 1); reverse.anchor + n <= tape; n++) {
      const turn = reverse.anchor + n;
      advanceMarks(turn, pitches);
      if (reverse.until !== null && turn >= reverse.until) {
        reverse = null;
        break;
      }
      flipMarks(turn);
    }
  }
  advanceMarks(tape, pitches);
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
