import * as Tone from "tone";
import "./style.css";
import oscProcessorUrl from "./worklet/osc-processor.ts?worker&url";
import type { OscMessage, Waveform } from "./worklet/osc-processor";
import { setupNav } from "./nav";
import { setupHelp } from "./help";
import { setupI18n } from "./i18n";
import { protectOutput } from "./audio";

// Keyboard ではスケールを使わないが、Ripples / Phase の設定をそのまま次のページへ渡す
setupNav();
protectOutput();
setupI18n();
setupHelp();

type Key = { note: string; pcKey: string; black: boolean };

// C4〜C6 の 2 オクターブ。下段 (Z 列) が C4〜B4、上段 (Q 列) が C5〜C6
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PC_KEYS = [..."zsxdcvgbhnjm", ..."q2w3er5t6y7ui"];

const KEYS: Key[] = PC_KEYS.map((pcKey, i) => {
  const name = NOTE_NAMES[i % 12];
  return { note: `${name}${4 + Math.floor(i / 12)}`, pcKey, black: name.endsWith("#") };
});

// 音源 → 音量 → Distortion → Chorus → Delay → Reverb → 出力
// エフェクトは常に接続しておき、オンオフは wet (エフェクト音の割合) で切り替える
const out = new Tone.Volume(-12);
const distortion = new Tone.Distortion({ distortion: 0.4, wet: 0 });
const chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0 }).start();
const delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.35, wet: 0 });
const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.3 });
out.chain(distortion, chorus, delay, reverb, Tone.getDestination());

const EFFECTS = [
  { id: "fx-distortion", wet: distortion.wet, on: 1 },
  { id: "fx-chorus", wet: chorus.wet, on: 0.5 },
  { id: "fx-delay", wet: delay.wet, on: 0.35 },
];

type Instrument = {
  attack(freq: number): void;
  release(freq: number): void;
  setWaveform?(type: OscillatorType): void;
};

type PolyLike = {
  triggerAttack(freq: number): unknown;
  triggerRelease(freq: number): unknown;
  set(options: object): unknown;
  connect(node: Tone.ToneAudioNode): unknown;
};

function polyOf(
  synth: PolyLike,
  waveformOptions = (type: OscillatorType): object => ({ oscillator: { type } }),
): Instrument {
  synth.connect(out);
  return {
    attack: (freq) => synth.triggerAttack(freq),
    release: (freq) => synth.triggerRelease(freq),
    setWaveform: (type) => synth.set(waveformOptions(type)),
  };
}

// PluckSynth は PolySynth に載せられないので、複数用意して順番に鳴らす
function pluckPool(size = 8): Instrument {
  const voices = Array.from({ length: size }, () => {
    const voice = new Tone.PluckSynth();
    voice.connect(out);
    return voice;
  });
  const held = new Map<number, Tone.PluckSynth>();
  let next = 0;
  return {
    attack(freq) {
      const voice = voices[next++ % size];
      held.set(freq, voice);
      voice.triggerAttack(freq);
    },
    release(freq) {
      held.get(freq)?.triggerRelease();
      held.delete(freq);
    },
  };
}

// AudioWorklet で自作した音源。モジュールの読み込みは非同期なので、届いた順にメッセージを送る
function workletSynth(): Instrument {
  const context = Tone.getContext();
  // Tone の addAudioWorkletModule は最初の 1 モジュールしか読み込まない（PluckSynth が内部で先に使う）ため、
  // rawContext に直接登録する
  const ready = context.rawContext.audioWorklet.addModule(oscProcessorUrl).then(() => {
    const node = context.createAudioWorkletNode("osc-processor", { outputChannelCount: [1] });
    Tone.connect(node, out);
    return node;
  });
  const send = (msg: OscMessage) => ready.then((node) => node.port.postMessage(msg));
  return {
    attack: (freq) => send({ type: "noteOn", freq }),
    release: (freq) => send({ type: "noteOff", freq }),
    setWaveform: (type) => send({ type: "waveform", value: type as Waveform }),
  };
}

const INSTRUMENTS: Record<string, Instrument> = {
  Synth: polyOf(
    new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.8 },
    }),
  ),
  AMSynth: polyOf(new Tone.PolySynth(Tone.AMSynth)),
  FMSynth: polyOf(new Tone.PolySynth(Tone.FMSynth)),
  DuoSynth: polyOf(new Tone.PolySynth(Tone.DuoSynth), (type) => ({
    voice0: { oscillator: { type } },
    voice1: { oscillator: { type } },
  })),
  MonoSynth: polyOf(new Tone.PolySynth(Tone.MonoSynth)),
  PluckSynth: pluckPool(),
  Worklet: workletSynth(),
};

let instrument = INSTRUMENTS.Synth;

const keyboardEl = document.querySelector<HTMLDivElement>("#keyboard")!;
const waveformEl = document.querySelector<HTMLSelectElement>("#waveform")!;
const volumeEl = document.querySelector<HTMLInputElement>("#volume")!;
const reverbEl = document.querySelector<HTMLInputElement>("#reverb")!;
const transposeEl = document.querySelector<HTMLInputElement>("#transpose")!;
const transposeValueEl = document.querySelector<HTMLOutputElement>("#transpose-value")!;
const octaveEl = document.querySelector<HTMLInputElement>("#octave")!;
const octaveValueEl = document.querySelector<HTMLOutputElement>("#octave-value")!;

const instrumentEl = document.querySelector<HTMLSelectElement>("#instrument")!;

const keyEls = new Map<string, HTMLButtonElement>();
// 鍵盤の音名 → 実際に鳴らした周波数と音源。押している間に設定が変わっても正しく止めるため
const pressed = new Map<string, { freq: number; inst: Instrument }>();
let transpose = 0;
let octave = 0;

async function noteOn(note: string) {
  if (pressed.has(note)) return;
  const freq = Tone.Frequency(note).transpose(transpose + octave * 12).toFrequency();
  const inst = instrument;
  pressed.set(note, { freq, inst });
  keyEls.get(note)?.classList.add("active");
  await Tone.start(); // 自動再生制限の解除（初回操作時のみ実際に効く）
  inst.attack(freq);
}

function noteOff(note: string) {
  const held = pressed.get(note);
  if (!held) return;
  pressed.delete(note);
  keyEls.get(note)?.classList.remove("active");
  held.inst.release(held.freq);
}

for (const key of KEYS) {
  const el = document.createElement("button");
  el.className = key.black ? "key black" : "key white";
  el.innerHTML = `<span>${key.pcKey.toUpperCase()}</span>`;
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    noteOn(key.note);
  });
  el.addEventListener("pointerup", () => noteOff(key.note));
  el.addEventListener("pointercancel", () => noteOff(key.note));
  keyboardEl.appendChild(el);
  keyEls.set(key.note, el);
}

const noteByPcKey = new Map(KEYS.map((k) => [k.pcKey, k.note]));

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const note = noteByPcKey.get(e.key.toLowerCase());
  if (note) noteOn(note);
});

window.addEventListener("keyup", (e) => {
  const note = noteByPcKey.get(e.key.toLowerCase());
  if (note) noteOff(note);
});

instrumentEl.addEventListener("change", () => {
  instrument = INSTRUMENTS[instrumentEl.value];
  waveformEl.disabled = !instrument.setWaveform;
});

// 波形は全音源にそろえておき、音源を切り替えても選択と一致させる
waveformEl.addEventListener("change", () => {
  for (const inst of Object.values(INSTRUMENTS)) {
    inst.setWaveform?.(waveformEl.value as OscillatorType);
  }
});

for (const fx of EFFECTS) {
  const el = document.querySelector<HTMLInputElement>(`#${fx.id}`)!;
  el.addEventListener("change", () => {
    fx.wet.value = el.checked ? fx.on : 0;
  });
}

volumeEl.addEventListener("input", () => {
  out.volume.value = Number(volumeEl.value);
});

reverbEl.addEventListener("input", () => {
  reverb.wet.value = Number(reverbEl.value);
});

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

transposeEl.addEventListener("input", () => {
  transpose = Number(transposeEl.value);
  transposeValueEl.value = signed(transpose);
});

octaveEl.addEventListener("input", () => {
  octave = Number(octaveEl.value);
  octaveValueEl.value = signed(octave);
});
