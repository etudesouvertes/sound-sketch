import * as Tone from "tone";
import "../ripples/style.css";
import { pitchAt } from "../scales";
import { setupCanvas, setupGenerativePage } from "../generative";
import { NEUTRAL_MOOD, type Mood } from "../weather";
import { onLangChange, tk } from "../i18n";
import { RadioStream } from "../broadcast/stream";
import { addWorkletModule, workletsAvailable } from "../audio";
import { findStations, reportClick, type Station, type StationKind } from "../broadcast/stations";
import speechProcessorUrl from "../broadcast/speech-processor.ts?worker&url";
import { newSeed, scoreNow, scoreState, seededRandom, seedNumber, syncClock } from "./score";
import { syncNavQuery } from "../nav";
import { pageLink, pageName, pageTitle, RECORD } from "../record";
import type { SpeechMessage } from "../broadcast/speech-processor";

// 何台かの短波受信機で、世界のインターネットラジオを拾う
// （ジョン・ケージ『Imaginary Landscape No. 4』の 12 台のラジオ、シュトックハウゼン『Kurzwellen』）。
// 受信機ごとに横長のダイヤル（短波の 1 つのバンド）があり、その上のあちこちに局と、放送のない搬送波が並ぶ。
// 針が局から離れているあいだは雑音だけ。近づくと、局の搬送波とのうなり（ビート音、ヘテロダイン）が鳴る。
// うなりの高さは、本物では針と局のずれに比例するが、ここではずれをスケールの音に割り当てるので、
// ダイヤルを回すと、うなりがスケールの音を階段のように上り下りする。ぴったり合わせると、うなりは消えて放送が聞こえる。
// 局の放送は、針が近づいたときに初めて受け取り始める（離れて少しすると止める）。つながらない局は、別の局に差し替える。
// 放送は、ゆっくり大きくなったり小さくなったりする（フェージング）。
// 天気: 雨でパチパチという雑音が増え、風でフェージングが深くなり、雲で雑音が増える。
// 「みんなで鳴らす」: 楽譜（score.ts）を作って QR で配ると、開いた人のスマホがそれぞれ 1 つのパートの受信機になり、
// 同じ楽譜に従ってダイヤルを回し、音量を変える。局の位置は楽譜の種で決まるので、どの端末でも同じ。
// どの局が鳴るかは端末ごとに違う（同じ動きで、違う声が重なる）。手で回すと、離して少しすると楽譜の位置へ戻る

type Slot = {
  pos: number; // ダイヤルの上の位置 (0〜1)
  kind: "station" | "carrier"; // 放送のある局か、放送のない搬送波か
  degree: number; // うなりの、いちばん低い音（スケールの度数）
  hue: number;
  station: Station | null; // まだ決めていない（一度も近づいていない）ときは null
  heard: string | null; // 聞いたことのある局の名前（ダイヤルに書く）
  dead: boolean; // つながる局が見つからなかった（搬送波として扱う）
};

type Receiver = {
  index: number; // 画面の上から何番目か
  band: number; // どのバンドか（BANDS の番号。みんなで鳴らすときはパートの番号 - 1）
  part: number | null; // みんなで鳴らすときのパート（1〜4）。そうでなければ null
  manualUntil: number; // 手で回したあと、楽譜に戻るまでの時刻 (秒)
  scoreTarget: number | null; // 楽譜で向かっている位置（描くため）
  volume: number; // 楽譜の音量
  slots: Slot[];
  pos: number; // 針の位置 (0〜1)
  target: number; // 針が向かう位置
  speed: number | null; // 自動で回すときの速さ（ダイヤル幅/秒）。null なら手で回していて、target にすぐ付いていく
  pointer: number | null; // 針をつかんでいる指
  autoAt: number; // 自動で次に回す時刻 (秒)
  // 音
  stream: RadioStream;
  out: Tone.Gain;
  panner: Tone.Panner;
  noise: Tone.Noise;
  noiseGain: Tone.Gain;
  crackle: Tone.Noise;
  crackleGain: Tone.Gain;
  compressor: Tone.Compressor;
  highpass: Tone.Filter;
  lowpass: Tone.Filter;
  speechGate: Tone.Gain;
  stationGain: Tone.Gain;
  whistle: Tone.Oscillator;
  whistleWobble: Tone.LFO;
  whistleGain: Tone.Gain;
  waveform: Tone.Waveform;
  speechNode: AudioWorkletNode | null;
  disposed: boolean;
  // 放送
  slot: Slot | null; // 受け取っている（受け取ろうとしている）局
  playing: boolean;
  tuning: number; // 選局の番号。新しく選局を始めたら、前の選局は途中でやめる
  lostAt: number | null; // 針が局から離れた時刻
  // フェージング
  fading: number;
  fadeTarget: number;
  fadeAt: number;
  // 話し声だけのとき
  speechHistory: number[];
  hearingSpeech: boolean;
  unsureSince: number | null;
  // 描くための今の値
  strength: number; // 一番近い局（搬送波）への合い方 (0〜1)
  whistleIndex: number; // うなりの音（スケールの番号）。鳴っていなければ -1
  whistleAmount: number;
};

// 受信機ごとのバンド（短波放送のバンドの名前と範囲。ダイヤルの目盛りに使う）
const BANDS = [
  { name: "49 m", from: 5.9, to: 6.2 },
  { name: "41 m", from: 7.2, to: 7.45 },
  { name: "31 m", from: 9.4, to: 9.9 },
  { name: "25 m", from: 11.6, to: 12.1 },
];
const STATIONS_PER_BAND = 5;
const CARRIERS_PER_BAND = 2;
const SLOT_EDGE = 0.04; // ダイヤルの端から、これだけ内側に局を置く
const SLOT_GAP = 0.09; // 局どうしの、これだけは空ける間

const TUNE_WIDTH = 0.012; // 放送が聞こえる幅（ずれの標準偏差。ダイヤル幅に対して）
const WHISTLE_WIDTH = 0.08; // うなりが聞こえる幅
const WHISTLE_STEPS = 12; // その幅を、スケールのいくつの音に分けるか
const CONNECT_RANGE = WHISTLE_WIDTH; // 針がこの中に入ったら、放送を受け取り始める
const LINGER = 4; // 針が離れてから、これだけ過ぎたら放送を止める (秒)
const DRAG_FOLLOW = 0.1; // 手で回すとき、針が指に追いつく速さ（時定数, 秒）。跳んだときは、間の局を通り過ぎる音が鳴る

const NOISE_LEVEL = 0.3;
const WHISTLE_LEVEL = 0.12;
const BROADCAST_LEVEL = 1;
const CRACKLE_RATE = 2; // 「空電」100% のときの、1 台あたり 1 秒あたりのパチパチの数（雨で増える）
const CRACKLE_LEVEL = [0.03, 0.12]; // パチパチ 1 つの大きさ（この範囲で選ぶ）

const RADIO_WAIT = 8000; // 1 局の音が出るまで待つ時間 (ミリ秒)
const RADIO_TRIES = 6; // 1 つの局の位置で試す局の数
// 話し声だけのとき（Tape と同じ判定。broadcast/speech-detector.ts）
const SPEECH_AVERAGE = 5;
const SPEECH_OPEN = 0.7;
const SPEECH_CLOSE = 0.4;
const UNSURE_SWITCH = 20;

const RETURN_AFTER = 4; // みんなで鳴らすとき、手を離してから楽譜に戻るまで (秒)
const RETURN_SPEED = 0.12; // 楽譜の位置へ戻る速さ（ダイヤル幅/秒）
const IDLE_BEFORE_AUTO = 6; // 操作がない状態が何秒続いたら自動で回し始めるか
const AUTO_SPEED = [0.015, 0.06]; // 自動で回す速さ（ダイヤル幅/秒）
const AUTO_DWELL = [8, 30]; // 回したあと、その位置にとどまる時間 (秒)

const between = ([low, high]: number[]) => low + Math.random() * (high - low);
const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const receiversEl = document.querySelector<HTMLInputElement>("#receivers")!;
const receiversValueEl = document.querySelector<HTMLOutputElement>("#receivers-value")!;
const broadcastLevelEl = document.querySelector<HTMLInputElement>("#broadcast-level")!;
const broadcastLevelValueEl = document.querySelector<HTMLOutputElement>("#broadcast-level-value")!;
const whistleLevelEl = document.querySelector<HTMLInputElement>("#whistle-level")!;
const whistleLevelValueEl = document.querySelector<HTMLOutputElement>("#whistle-level-value")!;
const noiseLevelEl = document.querySelector<HTMLInputElement>("#noise-level")!;
const noiseLevelValueEl = document.querySelector<HTMLOutputElement>("#noise-level-value")!;
const staticLevelEl = document.querySelector<HTMLInputElement>("#static-level")!;
const staticLevelValueEl = document.querySelector<HTMLOutputElement>("#static-level-value")!;
const stationKindEl = document.querySelector<HTMLSelectElement>("#station-kind")!;
const skipPoliticsEl = document.querySelector<HTMLInputElement>("#radio-skip-politics")!;
const skipReligionEl = document.querySelector<HTMLInputElement>("#radio-skip-religion")!;
const autoEl = document.querySelector<HTMLInputElement>("#auto")!;
const newDialEl = document.querySelector<HTMLButtonElement>("#new-dial")!;
const radioStatusEl = document.querySelector<HTMLElement>("#radio-status")!;
const ensembleToggleEl = document.querySelector<HTMLButtonElement>("#ensemble-toggle")!;
const ensemblePartEl = document.querySelector<HTMLSelectElement>("#ensemble-part")!;
const ensembleStatusEl = document.querySelector<HTMLElement>("#ensemble-status")!;

// --- みんなで鳴らす ---

// 楽譜の種（URL の score）と、この端末のパート（URL の part。"all" はすべてのパートを、受信機の台数だけ鳴らす）。
// part のない URL（QR で配った URL）を開いたら、パートをランダムに選ぶ
const PARTS = 4;
const params = new URLSearchParams(location.search);
let scoreSeed: string | null = params.get("score");
let ensemblePart: "all" | number = "all";
if (scoreSeed) {
  const part = params.get("part");
  const n = Number(part);
  ensemblePart = part === "all" ? "all" : Number.isInteger(n) && n >= 1 && n <= PARTS ? n : 1 + Math.floor(Math.random() * PARTS);
  // 楽譜の URL を開いた人には、はじめの案内もそれに合わせる（setupGenerativePage が表示する前に書き換える）
  document.querySelector<HTMLElement>("#hint")!.dataset.i18n = "hint.radioEnsemble";
}
const ensembleOn = () => scoreSeed !== null;
void syncClock();


// --- 音 ---

const reverb = new Tone.Reverb({ decay: 4, wet: 0.15 }).toDestination();
const master = new Tone.Gain(1).connect(reverb);

let mood: Omit<Mood, "icon"> = NEUTRAL_MOOD;
const page = setupGenerativePage({
  defaults: { scale: "major-pentatonic", root: "D" },
  reverb: { node: reverb, wet: 0.1, decay: 4 },
  applyParams: (params) => (mood = params.mood),
  // 録音モードでは、NOAA Weather Radio だけを受ける（上の findStations）。投稿の説明とクレジットにも書く
  recording: {
    info: () => ({
      slug: pageName,
      title: `${pageTitle} — NOAA Weather Radio`,
      link: pageLink,
      credits: ["Broadcasts: NOAA Weather Radio (U.S. public domain), relayed by wxradio.org"],
    }),
  },
  // ▶ で、自動でダイヤルを回すのをすぐ始める。一時停止のあいだは放送の受信を止める
  // （止めたまま受け取ると、届いた放送がたまって、再開したときに遅れて鳴る）。再開すると、針の近くの局につなぎ直す
  onPlay: () => {
    idle = IDLE_BEFORE_AUTO;
    const now = performance.now() / 1000;
    receivers.forEach((r, i) => (r.autoAt = now + i * 2));
  },
  onPause: () => {
    for (const r of receivers) disconnect(r);
  },
});

const talkOnly = () => stationKindEl.value === "talk";
const level = (el: HTMLInputElement) => Number(el.value) / 100;

// --- 局の一覧 ---

let queue: Station[] = [];
let fetching: Promise<void> | null = null;
let listVersion = 0; // 局の選び方を変えたら増やす。変える前に取りに行った一覧は使わない
let listed = new Set<string>(); // これまでに一覧で受け取った局
let staleUntil = 0; // 新しい局が 1 つもなかったときは、この時刻 (ミリ秒) まで取りに行かない（天気予報の局のように、局が少ないとき）
const failed = new Set<string>(); // つながらなかった局（もう試さない）
const REFETCH_WAIT = 5 * 60 * 1000;

// 取ってある局の一覧を捨てる（取りに行っている途中の一覧も、届いても使わない）
function clearQueue() {
  queue = [];
  fetching = null;
  listVersion++;
  listed = new Set();
  staleUntil = 0;
}
let statusKey: string | null = null;

function showStatus(key: string | null) {
  statusKey = key;
  radioStatusEl.textContent = key ? tk(key) : "";
}
onLangChange(() => showStatus(statusKey));

// まだどのダイヤルにも置いていない局を 1 つ取る。一覧がなくなったら取りに行く
async function takeStation(): Promise<Station | null> {
  for (;;) {
    const inUse = new Set(receivers.flatMap((r) => r.slots.map((s) => s.station?.stationuuid)));
    while (queue.length > 0) {
      const station = queue.shift()!;
      if (!inUse.has(station.stationuuid) && !failed.has(station.stationuuid)) return station;
    }
    if (performance.now() < staleUntil) return null;
    const version = listVersion;
    fetching ??= findStations({ kind: RECORD ? "noaa" : (stationKindEl.value as StationKind), skipPolitics: skipPoliticsEl.checked, skipReligion: skipReligionEl.checked })
      .then((list) => {
        if (version !== listVersion) return;
        const fresh = list.filter((s) => !listed.has(s.stationuuid));
        for (const s of fresh) listed.add(s.stationuuid);
        // 新しい局がなければ、しばらく取りに行かない。そのあいだは、前に受け取った局を使い回す
        if (fresh.length === 0) staleUntil = performance.now() + REFETCH_WAIT;
        queue.push(...list);
        showStatus(null);
      })
      .catch((e) => {
        console.warn(e);
        staleUntil = performance.now() + REFETCH_WAIT / 5;
        showStatus("radioStatus.listFailed");
      })
      .finally(() => {
        if (version === listVersion) fetching = null;
      });
    await fetching;
    if (version !== listVersion) return null;
    if (queue.length === 0 && performance.now() < staleUntil) return null;
  }
}

// --- 受信機 ---

// 「話し声だけ」の聞き分け。AudioWorklet が使えないとき（LAN の http の開発サーバー）は、聞き分けずに鳴らす
const speechReady = addWorkletModule(speechProcessorUrl);
speechReady.catch(() => {});

// ダイヤルに局と搬送波を並べる。みんなで鳴らすときは、楽譜の種から決まる乱数で並べ、どの端末でも同じ位置にする
function makeSlots(random: () => number = Math.random): Slot[] {
  const positions: number[] = [];
  const count = STATIONS_PER_BAND + CARRIERS_PER_BAND;
  for (let tries = 0; positions.length < count && tries < 1000; tries++) {
    const pos = SLOT_EDGE + random() * (1 - 2 * SLOT_EDGE);
    if (positions.every((p) => Math.abs(p - pos) >= SLOT_GAP)) positions.push(pos);
  }
  // 放送のない搬送波にする位置を、ランダムに選ぶ
  const carriers = new Set<number>();
  while (carriers.size < Math.min(CARRIERS_PER_BAND, positions.length)) carriers.add(Math.floor(random() * positions.length));
  return positions
    .sort((a, b) => a - b)
    .map((pos, i) => ({
      pos,
      kind: carriers.has(i) ? "carrier" : "station",
      degree: Math.floor(random() * 5),
      hue: (i / positions.length) * 300 + random() * 30,
      station: null,
      heard: null,
      dead: false,
    }));
}

function makeReceiver(index: number, count: number, part: number | null): Receiver {
  const out = new Tone.Gain(1);
  const panner = new Tone.Panner(count === 1 ? 0 : -0.6 + (1.2 * index) / (count - 1));
  out.chain(panner, master);

  const noise = new Tone.Noise("pink");
  const noiseFilter = new Tone.Filter({ type: "bandpass", frequency: 1400, Q: 0.5 });
  const noiseGain = new Tone.Gain(0);
  noise.chain(noiseFilter, noiseGain, out);
  const crackle = new Tone.Noise("white");
  // 高い音だけにすると耳に刺さるので、中ほどの帯域にする
  const crackleFilter = new Tone.Filter({ type: "bandpass", frequency: 2200, Q: 0.7 });
  const crackleGain = new Tone.Gain(0);
  crackle.chain(crackleFilter, crackleGain, out);

  const stream = new RadioStream();
  const compressor = new Tone.Compressor({ threshold: -24, ratio: 4 });
  const highpass = new Tone.Filter({ type: "highpass", frequency: 150 });
  const lowpass = new Tone.Filter({ type: "lowpass", frequency: 3500 });
  const speechGate = new Tone.Gain(talkOnly() ? 0 : 1);
  const stationGain = new Tone.Gain(0);
  stream.output.chain(compressor, highpass, lowpass, speechGate, stationGain, out);

  const whistle = new Tone.Oscillator(440, "sine");
  const whistleWobble = new Tone.LFO({ frequency: 0.2 + Math.random() * 0.3, min: -5, max: 5 });
  whistleWobble.connect(whistle.detune);
  const whistleGain = new Tone.Gain(0);
  whistle.chain(whistleGain, out);

  const waveform = new Tone.Waveform(256);
  out.connect(waveform);

  const slots = part !== null && scoreSeed ? makeSlots(seededRandom(seedNumber(scoreSeed), part)) : makeSlots();
  const start = Math.random();
  const r: Receiver = {
    index,
    band: part !== null ? part - 1 : index,
    part,
    manualUntil: 0,
    scoreTarget: null,
    volume: 1,
    slots,
    pos: start,
    target: start,
    speed: null,
    pointer: null,
    autoAt: 0,
    stream,
    out,
    panner,
    noise,
    noiseGain,
    crackle,
    crackleGain,
    compressor,
    highpass,
    lowpass,
    speechGate,
    stationGain,
    whistle,
    whistleWobble,
    whistleGain,
    waveform,
    speechNode: null,
    disposed: false,
    slot: null,
    playing: false,
    tuning: 0,
    lostAt: null,
    fading: 1,
    fadeTarget: 1,
    fadeAt: 0,
    speechHistory: [],
    hearingSpeech: false,
    unsureSince: null,
    strength: 0,
    whistleIndex: -1,
    whistleAmount: 0,
  };
  // 受信機ごとに、どれだけ雑音の帯域がずれているかを少し変える
  noiseFilter.frequency.value = 900 + Math.random() * 1200;

  speechReady.then(() => {
    if (r.disposed) return;
    const node = Tone.getContext().createAudioWorkletNode("speech-detector", {
      channelCount: 1,
      channelCountMode: "explicit",
      numberOfOutputs: 0,
    });
    node.port.onmessage = (e: MessageEvent<SpeechMessage>) => hearSpeech(r, e.data.speech);
    Tone.connect(stream.output, node);
    r.speechNode = node;
  }, () => {});
  // 消すときに一緒に消すノード
  disposables.set(r, [noiseFilter, crackleFilter]);
  return r;
}

const disposables = new Map<Receiver, Tone.ToneAudioNode[]>();

function disposeReceiver(r: Receiver) {
  r.disposed = true;
  r.tuning++;
  r.stream.stop();
  r.speechNode?.disconnect();
  for (const node of [
    r.out,
    r.panner,
    r.noise,
    r.noiseGain,
    r.crackle,
    r.crackleGain,
    r.compressor,
    r.highpass,
    r.lowpass,
    r.speechGate,
    r.stationGain,
    r.whistle,
    r.whistleWobble,
    r.whistleGain,
    r.waveform,
    r.stream.output,
    ...(disposables.get(r) ?? []),
  ]) {
    node.dispose();
  }
  disposables.delete(r);
}

let receivers: Receiver[] = [];

function buildReceivers() {
  for (const r of receivers) disposeReceiver(r);
  // みんなで鳴らすときは、受け持つパートの数だけ（全パートなら台数の設定だけ）
  const parts: (number | null)[] = !ensembleOn()
    ? Array.from({ length: Number(receiversEl.value) }, () => null)
    : ensemblePart === "all"
      ? Array.from({ length: Number(receiversEl.value) }, (_, i) => i + 1)
      : [ensemblePart];
  const count = parts.length;
  receivers = parts.map((part, i) => makeReceiver(i, count, part));
  // 楽譜の途中から入るので、針ははじめから楽譜の位置に置く
  for (const r of receivers) {
    const state = scoreOf(r);
    if (state) r.pos = r.target = state.pos;
  }
  const now = performance.now() / 1000;
  // 自動で回し始める時刻を、受信機ごとにずらす
  receivers.forEach((r, i) => (r.autoAt = now + i * 3 + Math.random() * 3));
}

// --- 選局 ---

function resetSpeech(r: Receiver) {
  r.speechHistory = [];
  r.hearingSpeech = false;
  r.unsureSince = null;
  r.speechNode?.port.postMessage("reset");
  applySpeechGate(r);
}

function applySpeechGate(r: Receiver) {
  const open = !talkOnly() || r.hearingSpeech || !workletsAvailable();
  r.speechGate.gain.setTargetAtTime(open ? 1 : 0, Tone.now(), 0.05);
}

async function connect(r: Receiver, slot: Slot) {
  const id = ++r.tuning;
  r.slot = slot;
  r.playing = false;
  r.stream.stop();
  resetSpeech(r);
  for (let tries = 0; tries < RADIO_TRIES; tries++) {
    if (!slot.station) {
      const station = await takeStation();
      if (id !== r.tuning) return;
      if (!station) break;
      slot.station = station;
    }
    const station = slot.station;
    const ok = await r.stream.play(station.url_resolved, RADIO_WAIT, () => {
      // 放送が途切れたら、同じ位置に別の局を探す
      if (id !== r.tuning) return;
      slot.station = null;
      void connect(r, slot);
    });
    if (id !== r.tuning) return;
    if (ok) {
      r.playing = true;
      slot.heard = `${station.name.trim()} · ${station.countrycode}`;
      resetSpeech(r);
      reportClick(station);
      return;
    }
    failed.add(station.stationuuid);
    slot.station = null;
  }
  if (id !== r.tuning) return;
  // つながる局が見つからなかった位置は、放送のない搬送波にする
  slot.dead = true;
  r.slot = null;
}

function disconnect(r: Receiver) {
  r.tuning++;
  r.stream.stop();
  r.slot = null;
  r.playing = false;
  r.lostAt = null;
}

// 今の局を、同じ位置の別の局に差し替える（音楽だった、話し声か分からないまま時間が過ぎた）
function replaceStation(r: Receiver) {
  const slot = r.slot;
  if (!slot) return;
  slot.station = null;
  slot.heard = null;
  void connect(r, slot);
}

function hearSpeech(r: Receiver, speech: number | null) {
  if (!talkOnly() || !r.playing) return;
  if (speech !== null) {
    r.speechHistory.push(speech);
    if (r.speechHistory.length > SPEECH_AVERAGE) r.speechHistory.shift();
    const average = r.speechHistory.reduce((sum, a) => sum + a, 0) / r.speechHistory.length;
    if (r.speechHistory.length >= SPEECH_AVERAGE && average < SPEECH_CLOSE) {
      replaceStation(r);
      return;
    }
    if (!r.hearingSpeech && average > SPEECH_OPEN) {
      r.hearingSpeech = true;
      applySpeechGate(r);
    }
  }
  const now = performance.now() / 1000;
  if (!r.hearingSpeech) {
    r.unsureSince ??= now;
    if (now - r.unsureSince > UNSURE_SWITCH) replaceStation(r);
  } else r.unsureSince = null;
}

// 針の位置で、一番近い局（搬送波）と、そのずれ
function nearestSlot(r: Receiver): { slot: Slot; offset: number } {
  let best = r.slots[0];
  for (const s of r.slots) if (Math.abs(s.pos - r.pos) < Math.abs(best.pos - r.pos)) best = s;
  return { slot: best, offset: Math.abs(r.pos - best.pos) };
}

// --- 1 フレームごとの更新 ---

const SCORE_WIDTHS = { tune: TUNE_WIDTH, whistle: WHISTLE_WIDTH, whistleSteps: WHISTLE_STEPS };
const scoreOf = (r: Receiver) => (r.part !== null && scoreSeed ? scoreState(scoreSeed, r.part, r.slots, SCORE_WIDTHS, scoreNow()) : null);

// みんなで鳴らすとき、針を楽譜の位置へ。手で回しているあいだと、離してから少しのあいだは手のまま。
// 楽譜から離れているときは、楽譜の位置へゆっくり戻り、追いついたら楽譜どおりに動く
function followScore(r: Receiver, now: number) {
  const state = scoreOf(r);
  if (!state) {
    r.scoreTarget = null;
    r.volume = 1;
    return;
  }
  r.scoreTarget = state.target;
  r.volume = state.volume;
  if (r.pointer !== null || now < r.manualUntil) return;
  r.target = state.pos;
  r.speed = Math.abs(r.pos - state.pos) > 0.003 ? RETURN_SPEED : null;
}

function updateReceiver(r: Receiver, dt: number, now: number) {
  // 雑音とうなりは、音を出せるようになってから鳴らし始める
  if (r.noise.state !== "started") for (const source of [r.noise, r.crackle, r.whistle, r.whistleWobble]) source.start();

  followScore(r, now);
  r.out.gain.setTargetAtTime(r.volume, Tone.now(), 0.3);

  // 針を動かす
  if (r.speed === null) r.pos += (r.target - r.pos) * (1 - Math.exp(-dt / DRAG_FOLLOW));
  else {
    const step = r.speed * dt;
    r.pos = Math.abs(r.target - r.pos) <= step ? r.target : r.pos + Math.sign(r.target - r.pos) * step;
  }

  const { slot, offset } = nearestSlot(r);

  // 放送を受け取り始める・止める
  const want = slot.kind === "station" && !slot.dead && offset < CONNECT_RANGE ? slot : null;
  if (want) {
    r.lostAt = null;
    if (r.slot !== want) void connect(r, want);
  } else if (r.slot) {
    r.lostAt ??= now;
    if (now - r.lostAt > LINGER) disconnect(r);
  }

  // フェージング: 数秒ごとに向かう大きさを選び直し、ゆっくり近づく。風が強いほど深い
  if (now > r.fadeAt) {
    const depth = 0.25 + 0.5 * mood.spread;
    r.fadeTarget = 1 - depth * Math.random() ** 0.7;
    r.fadeAt = now + 2 + Math.random() * 5;
  }
  r.fading += (r.fadeTarget - r.fading) * (1 - Math.exp(-dt / 1.5));

  const t = Tone.now();
  const strength = Math.exp(-0.5 * (offset / TUNE_WIDTH) ** 2);
  r.strength = strength;
  const hearing = slot === r.slot && r.playing;
  r.stationGain.gain.setTargetAtTime(hearing ? strength * r.fading * BROADCAST_LEVEL * level(broadcastLevelEl) : 0, t, 0.03);
  // 合っていないほど、こもって細い音にする
  r.lowpass.frequency.setTargetAtTime(500 + 3000 * strength, t, 0.05);
  r.highpass.frequency.setTargetAtTime(150 + 500 * (1 - strength), t, 0.05);

  // 搬送波に合うと、受信機の音量の自動調整で雑音が下がる
  const noise = NOISE_LEVEL * level(noiseLevelEl) * (0.8 + 0.4 * mood.wetness) * (1 - 0.85 * strength * r.fading);
  r.noiseGain.gain.setTargetAtTime(noise, t, 0.05);

  // パチパチという雑音（空電）
  const crackles = CRACKLE_RATE * (0.5 + 0.5 * mood.density) * (1 - 0.7 * strength) * level(staticLevelEl);
  if (Math.random() < crackles * dt) {
    // 立ち上がりを 2 ミリ秒かけて、カチッという角を丸める
    const amount = between(CRACKLE_LEVEL);
    r.crackleGain.gain
      .cancelScheduledValues(t)
      .setValueAtTime(0, t)
      .linearRampToValueAtTime(amount, t + 0.002)
      .setTargetAtTime(0, t + 0.002, 0.003 + Math.random() * 0.008);
  }

  // うなり: ずれを WHISTLE_STEPS 段に分け、段ごとにスケールの音を割り当てる。ぴったり合うと消える
  if (offset < WHISTLE_WIDTH) {
    const index = Math.min(Math.floor((offset / WHISTLE_WIDTH) * WHISTLE_STEPS), WHISTLE_STEPS - 1);
    const pitchIndex = slot.degree + index;
    if (pitchIndex !== r.whistleIndex) {
      r.whistle.frequency.setTargetAtTime(pitchAt(page.pitches(), pitchIndex).freq, t, 0.008);
      r.whistleIndex = pitchIndex;
    }
    const carrier = (1 - offset / WHISTLE_WIDTH) ** 2;
    const beat = clamp((offset - 0.25 * TUNE_WIDTH) / (0.75 * TUNE_WIDTH), 0, 1);
    r.whistleAmount = carrier * beat * r.fading;
  } else {
    r.whistleIndex = -1;
    r.whistleAmount = 0;
  }
  r.whistleGain.gain.setTargetAtTime(WHISTLE_LEVEL * level(whistleLevelEl) * r.whistleAmount, t, 0.02);
}

// 自動: 局に合わせる、搬送波の近くでうなりを 1 つの音に止める、どこでもないところで雑音を聴く、のどれかへゆっくり回す
function autoTune(r: Receiver, now: number) {
  if (r.pointer !== null || now < r.autoAt) return;
  const alive = r.slots.filter((s) => s.kind === "station" && !s.dead);
  const roll = Math.random();
  let target: number;
  if (roll < 0.6 && alive.length > 0) {
    const s = alive[Math.floor(Math.random() * alive.length)];
    target = s.pos + (Math.random() - 0.5) * 0.4 * TUNE_WIDTH;
  } else if (roll < 0.9) {
    const s = r.slots[Math.floor(Math.random() * r.slots.length)];
    const step = 1 + Math.floor(Math.random() * (WHISTLE_STEPS - 2));
    target = s.pos + (Math.random() < 0.5 ? -1 : 1) * ((step + 0.5) / WHISTLE_STEPS) * WHISTLE_WIDTH;
  } else target = Math.random();
  r.target = clamp(target, 0, 1);
  r.speed = between(AUTO_SPEED);
  const travel = Math.abs(r.target - r.pos) / r.speed;
  r.autoAt = now + travel + between(AUTO_DWELL) / page.autoDensity();
}

// --- 画面 ---

let width = 0;
let height = 0;
const g = setupCanvas(canvas, (w, h) => {
  width = w;
  height = h;
});

const BOTTOM = 36; // 下の表示の分
const SIDE = 24;
const barEl = document.querySelector<HTMLElement>(".bar")!;
// 上のバーの分。狭い画面ではバーが 2 段以上に折り返すので、その高さに合わせる（隠れているあいだも、場所は空けたまま）
let top = 64;
const measureTop = () => (top = Math.max(64, barEl.getBoundingClientRect().bottom + 4));

const bandHeight = () => (height - top - BOTTOM) / receivers.length;
const bandTop = (i: number) => top + i * bandHeight();
const xOf = (pos: number) => SIDE + pos * (width - 2 * SIDE);
const posOf = (x: number) => clamp((x - SIDE) / (width - 2 * SIDE), 0, 1);

function drawReceiver(r: Receiver) {
  const band = BANDS[r.band];
  const top = bandTop(r.index) + 6;
  const h = bandHeight() - 12;
  const bottom = top + h;
  const left = xOf(0);
  const right = xOf(1);

  g.fillStyle = "rgba(255, 255, 255, 0.025)";
  g.beginPath();
  g.roundRect(left - 12, top, right - left + 24, h, 8);
  g.fill();

  // バンドの名前と、今聞こえている局
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "left";
  g.fillStyle = "rgba(255, 255, 255, 0.4)";
  const partLabel = r.part !== null ? `🎼 ${tk("ensemble.part")} ${r.part}  ·  ` : "";
  g.fillText(`${partLabel}${band.name}  ${band.from.toFixed(2)}–${band.to.toFixed(2)} MHz`, left, top + 16);
  // 楽譜で黙っているあいだは、帯を暗くして「休み」と出す
  if (r.part !== null && r.volume < 0.05) {
    g.fillStyle = "rgba(27, 29, 35, 0.6)";
    g.fillRect(left - 12, top + 22, right - left + 24, h - 22);
    g.fillStyle = "rgba(255, 255, 255, 0.35)";
    g.textAlign = "center";
    g.fillText(tk("ensemble.rest"), (left + right) / 2, top + h / 2);
  }
  const mhz = band.from + r.pos * (band.to - band.from);
  const { slot } = nearestSlot(r);
  let label = `${mhz.toFixed(3)} MHz`;
  if (r.slot === slot && r.strength > 0.2) {
    if (r.playing && slot.heard) label += `  ·  ${slot.heard}${talkOnly() && !r.hearingSpeech ? "  👂" : ""}`;
    else if (!r.playing) label += "  ·  …";
  }
  g.textAlign = "right";
  g.fillStyle = `rgba(255, 255, 255, ${0.35 + 0.5 * r.strength})`;
  g.fillText(label, right, top + 16);

  // 目盛り
  const scaleY = bottom - 22;
  g.strokeStyle = "rgba(255, 255, 255, 0.15)";
  g.fillStyle = "rgba(255, 255, 255, 0.25)";
  g.lineWidth = 1;
  g.textAlign = "center";
  g.font = "9px system-ui, sans-serif";
  const step = 0.01;
  for (let f = Math.ceil(band.from / step) * step; f <= band.to + 1e-9; f += step) {
    const x = xOf((f - band.from) / (band.to - band.from));
    const major = Math.round(f * 100) % 5 === 0;
    g.beginPath();
    g.moveTo(x, scaleY);
    g.lineTo(x, scaleY - (major ? 8 : 4));
    g.stroke();
    if (major && Math.round(f * 100) % 10 === 0) g.fillText(f.toFixed(1), x, scaleY + 11);
  }

  // 局と搬送波の印。聞いたことのある局は名前を添える
  for (const s of r.slots) {
    const x = xOf(s.pos);
    const live = s.kind === "station" && !s.dead;
    g.fillStyle = live ? `hsla(${s.hue}, 70%, 65%, 0.7)` : "rgba(255, 255, 255, 0.3)";
    g.beginPath();
    g.moveTo(x, scaleY - 10);
    g.lineTo(x - 3, scaleY - 16);
    g.lineTo(x + 3, scaleY - 16);
    g.closePath();
    g.fill();
    if (s.heard && live && s !== slot) {
      g.fillStyle = `hsla(${s.hue}, 40%, 70%, 0.35)`;
      g.font = "9px system-ui, sans-serif";
      g.fillText(s.heard.length > 22 ? `${s.heard.slice(0, 21)}…` : s.heard, x, scaleY - 20);
    }
  }

  // 受信機の音の波形
  const values = r.waveform.getValue();
  const mid = top + 24 + (scaleY - 30 - top - 24) / 2;
  const amp = (scaleY - 30 - top - 24) / 2;
  const hue = slot.kind === "station" ? slot.hue : 0;
  g.strokeStyle = `hsla(${hue}, ${Math.round(70 * r.strength)}%, 70%, ${0.25 + 0.5 * Math.max(r.strength, r.whistleAmount)})`;
  g.lineWidth = 1.2;
  g.beginPath();
  values.forEach((v, i) => {
    const x = left + (i / (values.length - 1)) * (right - left);
    const y = mid - clamp(v * 4, -1, 1) * amp;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();

  // 楽譜で向かっている位置（薄い点線）
  if (r.scoreTarget !== null && Math.abs(r.scoreTarget - r.pos) > 0.003) {
    const tx = xOf(r.scoreTarget);
    g.strokeStyle = "rgba(255, 122, 89, 0.3)";
    g.lineWidth = 1;
    g.setLineDash([3, 4]);
    g.beginPath();
    g.moveTo(tx, top + 24);
    g.lineTo(tx, bottom - 4);
    g.stroke();
    g.setLineDash([]);
  }

  // 針
  const x = xOf(r.pos);
  g.strokeStyle = `rgba(255, 122, 89, ${0.6 + 0.4 * r.strength})`;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x, top + 24);
  g.lineTo(x, bottom - 4);
  g.stroke();
  // うなりの音名
  if (r.whistleIndex >= 0 && r.whistleAmount > 0.05) {
    g.fillStyle = `rgba(255, 200, 150, ${Math.min(1, r.whistleAmount * 2)})`;
    g.font = "10px system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText(pitchAt(page.pitches(), r.whistleIndex).label, x + 6, top + 34);
  }
}

function draw() {
  measureTop(); // フォントの読み込みや言語の切り替えでも、バーの高さは変わる
  g.fillStyle = "#1b1d23";
  g.fillRect(0, 0, width, height);
  for (const r of receivers) drawReceiver(r);
}

// --- 操作 ---

let last = performance.now();
let idle = 0;

function frame(nowMs: number) {
  const dt = Math.min((nowMs - last) / 1000, 0.05);
  last = nowMs;
  const now = nowMs / 1000;
  idle += dt;
  const auto = page.playing() && autoEl.checked && idle >= IDLE_BEFORE_AUTO && !ensembleOn();
  for (const r of receivers) {
    if (auto) autoTune(r, now);
    if (page.playing()) updateReceiver(r, dt, now);
    else if (ensembleOn()) {
      // 始める前も、針は楽譜どおりに動かして見せる
      const state = scoreOf(r);
      if (state) r.pos = r.target = state.pos;
    }
  }
  draw();
  requestAnimationFrame(frame);
}

function receiverAt(y: number): Receiver | null {
  const i = Math.floor((y - top) / bandHeight());
  return receivers[clamp(i, 0, receivers.length - 1)] ?? null;
}

function grab(r: Receiver, x: number) {
  r.target = posOf(x);
  r.speed = null;
  idle = 0;
  // 手を離したあと、自動はしばらく待ってから回す。みんなで鳴らすときは、しばらくしてから楽譜に戻る
  const now = performance.now() / 1000;
  r.autoAt = now + IDLE_BEFORE_AUTO + between(AUTO_DWELL) / 2;
  r.manualUntil = now + RETURN_AFTER;
}

canvas.addEventListener("pointerdown", async (e) => {
  const r = receiverAt(e.clientY);
  if (!r) return;
  canvas.setPointerCapture(e.pointerId);
  r.pointer = e.pointerId;
  grab(r, e.clientX);
  await page.ensureStarted();
});
canvas.addEventListener("pointermove", (e) => {
  for (const r of receivers) if (r.pointer === e.pointerId) grab(r, e.clientX);
});
const release = (e: PointerEvent) => {
  for (const r of receivers) if (r.pointer === e.pointerId) r.pointer = null;
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
// ホイール（2 本指のスクロール）で、細かく合わせる
canvas.addEventListener(
  "wheel",
  (e) => {
    const r = receiverAt(e.clientY);
    if (!r || !page.started()) return;
    e.preventDefault();
    const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.00015;
    grab(r, xOf(clamp(r.target + delta, 0, 1)));
  },
  { passive: false },
);

// --- 設定 ---

const showValue = (input: HTMLInputElement, output: HTMLOutputElement, format: (v: string) => string) => {
  const show = () => (output.value = format(input.value));
  input.addEventListener("input", show);
  show();
};
showValue(receiversEl, receiversValueEl, (v) => v);
showValue(broadcastLevelEl, broadcastLevelValueEl, (v) => `${v}%`);
showValue(whistleLevelEl, whistleLevelValueEl, (v) => `${v}%`);
showValue(noiseLevelEl, noiseLevelValueEl, (v) => `${v}%`);
showValue(staticLevelEl, staticLevelValueEl, (v) => `${v}%`);
receiversEl.addEventListener("change", buildReceivers);

// 局の選び方を変えたら、ダイヤルに置いた局を選び直す（局の位置はそのまま）
function reselectStations() {
  clearQueue();
  for (const r of receivers) {
    disconnect(r);
    for (const s of r.slots) {
      s.station = null;
      s.heard = null;
      s.dead = false;
    }
    resetSpeech(r);
  }
}
stationKindEl.addEventListener("change", reselectStations);
skipPoliticsEl.addEventListener("change", reselectStations);
skipReligionEl.addEventListener("change", reselectStations);

// みんなで鳴らすときは、局の位置は楽譜で決まっているので、局だけを選び直す
newDialEl.addEventListener("click", () => {
  if (ensembleOn()) {
    reselectStations();
    return;
  }
  clearQueue();
  buildReceivers();
});

function writeEnsembleUrl() {
  const url = new URL(location.href);
  if (scoreSeed) {
    url.searchParams.set("score", scoreSeed);
    url.searchParams.set("part", String(ensemblePart));
  } else {
    url.searchParams.delete("score");
    url.searchParams.delete("part");
  }
  history.replaceState(null, "", url);
  syncNavQuery();
}

function showEnsemble() {
  ensembleToggleEl.textContent = tk(ensembleOn() ? "ensemble.stop" : "ensemble.start");
  ensemblePartEl.disabled = !ensembleOn();
  ensemblePartEl.value = String(ensemblePart);
  // 1 つのパートだけを鳴らすときは、台数は 1 台
  receiversEl.disabled = ensembleOn() && ensemblePart !== "all";
  autoEl.disabled = ensembleOn();
  ensembleStatusEl.textContent = scoreSeed
    ? `🎼 ${tk("ensemble.score")} ${scoreSeed} · ${ensemblePart === "all" ? tk("ensemblePart.all") : `${tk("ensemble.part")} ${ensemblePart}`}`
    : "";
}
onLangChange(showEnsemble);

ensembleToggleEl.addEventListener("click", () => {
  if (ensembleOn()) scoreSeed = null;
  else {
    // 新しい楽譜を作り、このページ（ふつうはスピーカーにつないだパソコン）は全パートを鳴らす
    scoreSeed = newSeed();
    ensemblePart = "all";
  }
  writeEnsembleUrl();
  showEnsemble();
  buildReceivers();
});
ensemblePartEl.addEventListener("change", () => {
  ensemblePart = ensemblePartEl.value === "all" ? "all" : Number(ensemblePartEl.value);
  writeEnsembleUrl();
  showEnsemble();
  buildReceivers();
});
if (scoreSeed) writeEnsembleUrl();
showEnsemble();

buildReceivers();
requestAnimationFrame(frame);
