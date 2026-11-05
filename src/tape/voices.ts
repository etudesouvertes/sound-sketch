import * as Tone from "tone";

// Tape で鳴らす 1 音（声）。1 音ごとに作って鳴らし、鳴り終わったら捨てる。
// 「なめらかにつなぐ」で音程を途中で動かせるよう、frequency を外に出す。
// 音量は作るときに決める（あとから volume.value に代入すると先読みの分（0.1 秒）遅れて効き、鳴り始めだけ大きくなる）
export type Voice = {
  frequency: Tone.Signal<"frequency">;
  triggerAttack: (freq: number, time: number, velocity: number) => void;
  triggerRelease: (time: number) => void;
  dispose: () => void;
  release: number; // 離してから鳴り終わるまで (秒)
};

// 倍音の多い、少しずらした 2 本のノコギリ波。弾いた瞬間は明るく、すぐ落ち着く。
// テープを回るたびに高い倍音から削られていくので、層の新しさが音色でも分かる。
// ドライブでは、歪ませる先（Part の distortion）で長く伸びるよう、落ち着いたあとの大きさと余韻を大きくする
export function sawVoice(drive: boolean, destinations: Tone.InputNode[]): Voice {
  const envelope = drive ? { sustain: 0.6, release: 2.5 } : { sustain: 0.35, release: 1.8 };
  const synth = new Tone.MonoSynth({
    oscillator: { type: "fatsawtooth", count: 2, spread: 12 },
    filter: { type: "lowpass", Q: 1, rolloff: -24 },
    filterEnvelope: { attack: 0.005, decay: 0.8, sustain: 0.45, release: 1.5, baseFrequency: 350, octaves: 3.5 },
    envelope: { attack: 0.005, decay: 1.2, ...envelope },
    volume: -20,
  });
  synth.fan(...destinations);
  return {
    frequency: synth.frequency,
    triggerAttack: (freq, time, velocity) => synth.triggerAttack(freq, time, velocity),
    triggerRelease: (time) => synth.triggerRelease(time),
    dispose: () => synth.dispose(),
    release: envelope.release,
  };
}

// 弓で弾く弦楽器（合成）。弓で弾くように少しゆっくり立ち上がり、伸ばしている間は大きさが落ちない。
// 少し遅れてビブラートがかかり始め、弓の擦れる音（帯域を絞ったノイズ）が少し混ざる。
// 胴の響きは、低めと中ほどの 2 つの膨らみと、上の帯域の丸みで作る
type Bowed = {
  volume: number; // dB
  attack: number;
  release: number;
  vibrato: { cents: number; rate: number; delay: number; rise: number };
  body: { low: number; mid: number; top: number }; // 胴の響きの膨らみ (Hz) 2 つと、丸める高さ (Hz)
  bottom: number; // これより下を削る (Hz)
  bow: { level: number; freq: number };
};

const CELLO: Bowed = {
  volume: -24,
  attack: 0.12,
  release: 0.8,
  vibrato: { cents: 14, rate: 5.2, delay: 0.3, rise: 0.6 },
  body: { low: 230, mid: 1100, top: 3000 },
  bottom: 60,
  bow: { level: 0.035, freq: 2500 },
};

// コントラバスはチェロより遅く立ち上がり、ビブラートは浅くゆっくり、胴の響きは低く、音はこもりめ
const CONTRABASS: Bowed = {
  volume: -27,
  attack: 0.18,
  release: 1.0,
  vibrato: { cents: 8, rate: 4.6, delay: 0.4, rise: 0.8 },
  body: { low: 110, mid: 600, top: 1800 },
  bottom: 30,
  bow: { level: 0.025, freq: 1500 },
};

// 1 本の弦楽器の音のつながりを作る。音程は frequency（外から信号をつなげる）で決まる
function bowed(spec: Bowed, destinations: Tone.InputNode[]) {
  const out = new Tone.Gain(Tone.dbToGain(spec.volume));
  out.fan(...destinations);
  const highpass = new Tone.Filter({ type: "highpass", frequency: spec.bottom, Q: 0.5 });
  const lowBody = new Tone.Filter({ type: "peaking", frequency: spec.body.low, Q: 1.4, gain: 6 });
  const midBody = new Tone.Filter({ type: "peaking", frequency: spec.body.mid, Q: 1.5, gain: 3 });
  const lowpass = new Tone.Filter({ type: "lowpass", frequency: spec.body.top, Q: 0.7, rolloff: -24 });
  const envelope = new Tone.AmplitudeEnvelope({ attack: spec.attack, decay: 0.3, sustain: 0.8, release: spec.release });
  envelope.chain(highpass, lowBody, midBody, lowpass, out);

  const osc = new Tone.Oscillator({ type: "sawtooth", frequency: 0 }).connect(envelope);
  const { cents, rate, delay, rise } = spec.vibrato;
  const vibrato = new Tone.LFO({ frequency: rate, min: -cents, max: cents, amplitude: 0 });
  vibrato.connect(osc.detune);
  const noise = new Tone.Noise("pink");
  const bowFilter = new Tone.Filter({ type: "bandpass", frequency: spec.bow.freq, Q: 1 });
  const bowLevel = new Tone.Gain(spec.bow.level);
  noise.chain(bowFilter, bowLevel, envelope);

  const nodes = [out, highpass, lowBody, midBody, lowpass, envelope, osc, vibrato, noise, bowFilter, bowLevel];
  return {
    frequency: osc.frequency,
    attack: (time: number, velocity: number) => {
      osc.start(time);
      noise.start(time);
      vibrato.start(time);
      vibrato.amplitude.setValueAtTime(0, time + delay).linearRampToValueAtTime(1, time + delay + rise);
      envelope.triggerAttack(time, velocity);
    },
    releaseAt: (time: number) => envelope.triggerRelease(time),
    dispose: () => {
      for (const node of nodes) node.dispose();
    },
    release: spec.release,
  };
}

// 弦楽器を何本か重ねた声。音程は 1 つの信号で決め、それぞれには ratio 倍してつなぐ（なめらかに滑らせても音程の関係が崩れない）
function bowedVoice(layers: { spec: Bowed; ratio: number }[], destinations: Tone.InputNode[]): Voice {
  const frequency = new Tone.Signal<"frequency">({ value: 0, units: "frequency" });
  const strings = layers.map(({ spec, ratio }) => {
    const string = bowed(spec, destinations);
    const scale = new Tone.Multiply(ratio);
    frequency.chain(scale, string.frequency);
    return { string, scale };
  });
  return {
    frequency,
    triggerAttack: (freq, time, velocity) => {
      frequency.setValueAtTime(freq, time);
      for (const { string } of strings) string.attack(time, velocity);
    },
    triggerRelease: (time) => {
      for (const { string } of strings) string.releaseAt(time);
    },
    dispose: () => {
      frequency.dispose();
      for (const { string, scale } of strings) {
        string.dispose();
        scale.dispose();
      }
    },
    release: Math.max(...strings.map(({ string }) => string.release)),
  };
}

export const celloVoice = (destinations: Tone.InputNode[]) => bowedVoice([{ spec: CELLO, ratio: 1 }], destinations);

// チェロと、そのオクターブ下のコントラバスのユニゾン
export const celloBassVoice = (destinations: Tone.InputNode[]) =>
  bowedVoice(
    [
      { spec: CELLO, ratio: 1 },
      { spec: CONTRABASS, ratio: 0.5 },
    ],
    destinations,
  );
