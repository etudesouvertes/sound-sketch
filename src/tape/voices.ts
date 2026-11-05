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

// 合奏の 1 人分。チェロ・コントラバスを、ゆっくり立ち上げ、弓の音を抜いて小さくしたもの（人数分重ねるので）
const SECTION_CELLO: Bowed = { ...CELLO, volume: -30, attack: 0.45, release: 1.5, bow: { level: 0, freq: 0 } };
const SECTION_BASS: Bowed = { ...CONTRABASS, volume: -32, attack: 0.55, release: 1.6, bow: { level: 0, freq: 0 } };

// 重ねる 1 本。ratio は音程の倍率、detune は音程のずれ (セント)、delay は弾き始めの遅れ (秒)、
// rate はビブラートの速さの倍率（1 人ずつ少し変えて、揺れがそろわないようにする）
type Layer = { spec: Bowed; ratio: number; detune?: number; delay?: number; rate?: number };

// 1 本の弦楽器の音のつながりを作る。音程は frequency（外から信号をつなげる）で決まる。
// ずれ（detune）は、ビブラートの揺れの中心をずらして作る（LFO をつなぐと、つないだ先の値は上書きされるため）
function bowed({ spec, detune = 0, delay: late = 0, rate: rateScale = 1 }: Layer, destinations: Tone.InputNode[]) {
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
  const vibrato = new Tone.LFO({ frequency: rate * rateScale, min: detune - cents, max: detune + cents, amplitude: 0 });
  vibrato.connect(osc.detune);
  const nodes: { dispose: () => void }[] = [out, highpass, lowBody, midBody, lowpass, envelope, osc, vibrato];

  // 弓の擦れる音。合奏では人数分重ねると雑音っぽくなるので、入れない（level 0）
  let noise: Tone.Noise | null = null;
  if (spec.bow.level > 0) {
    noise = new Tone.Noise("pink");
    const bowFilter = new Tone.Filter({ type: "bandpass", frequency: spec.bow.freq, Q: 1 });
    const bowLevel = new Tone.Gain(spec.bow.level);
    noise.chain(bowFilter, bowLevel, envelope);
    nodes.push(noise, bowFilter, bowLevel);
  }

  return {
    frequency: osc.frequency,
    attack: (at: number, velocity: number) => {
      const time = at + late;
      osc.start(time);
      noise?.start(time);
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
function bowedVoice(layers: Layer[], destinations: Tone.InputNode[]): Voice {
  const frequency = new Tone.Signal<"frequency">({ value: 0, units: "frequency" });
  const strings = layers.map((layer) => {
    const string = bowed(layer, destinations);
    const scale = new Tone.Multiply(layer.ratio);
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
    release: Math.max(...strings.map(({ string }) => string.release)) + Math.max(...layers.map((l) => l.delay ?? 0)),
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

// 弦楽合奏。同じ高さを 3 人、オクターブ下を 2 人で弾く。1 人ずつ音程を数セント、弾き始めを数十ミリ秒、
// ビブラートの速さを少しずつずらし、その揺らぎの重なりで、輪郭のぼやけた霧のような響きにする
export const stringsVoice = (destinations: Tone.InputNode[]) =>
  bowedVoice(
    [
      { spec: SECTION_CELLO, ratio: 1, detune: -8, delay: 0, rate: 0.92 },
      { spec: SECTION_CELLO, ratio: 1, detune: -1, delay: 0.04, rate: 1.07 },
      { spec: SECTION_CELLO, ratio: 1, detune: 7, delay: 0.09, rate: 1 },
      { spec: SECTION_BASS, ratio: 0.5, detune: -5, delay: 0.02, rate: 0.95 },
      { spec: SECTION_BASS, ratio: 0.5, detune: 4, delay: 0.07, rate: 1.1 },
    ],
    destinations,
  );


// メロトロン。鍵盤ごとに録音テープが 1 本あり、押すとそのテープを頭から再生する楽器（ここではバイオリンのテープ）。
// 少しずらした 3 本のノコギリ波を、帯域の狭い、鼻にかかった音に整え、テープの回転の揺れ（ワウ・フラッター）と、小さなノイズを乗せる。
// 揺れの位相と速さは 1 音ごとに変え、和音で揺れがそろわないようにする。
// 本物のテープは約 8 秒で終わるので、limited なら 8 秒で止める（押し続けても、テープが尽きたところで消える）
const MELLOTRON = {
  volume: -24,
  attack: 0.07, // テープを押し当ててから音が出るまで
  release: 0.3, // 離すとテープが戻り、すぐ消える
  limit: 8, // テープの長さ (秒)
  ending: 0.2, // テープが尽きるときに消えていく時間 (秒)
  detunes: [-9, 0, 8], // 3 本のずれ (セント)
  wow: { cents: 7, rate: 0.7 },
  flutter: { cents: 3, rate: 7.5 },
  hiss: 0.012,
};

export function mellotronVoice(limited: boolean, destinations: Tone.InputNode[]): Voice {
  const m = MELLOTRON;
  const out = new Tone.Gain(Tone.dbToGain(m.volume));
  out.fan(...destinations);
  const tapeEnd = new Tone.Gain(1).connect(out);
  const highpass = new Tone.Filter({ type: "highpass", frequency: 220, Q: 0.5 });
  const nasal = new Tone.Filter({ type: "peaking", frequency: 1500, Q: 1.8, gain: 5 });
  const lowpass = new Tone.Filter({ type: "lowpass", frequency: 5000, Q: 0.5, rolloff: -24 });
  const envelope = new Tone.AmplitudeEnvelope({ attack: m.attack, decay: 0.4, sustain: 0.85, release: m.release });
  envelope.chain(highpass, nasal, lowpass, tapeEnd);

  const frequency = new Tone.Signal<"frequency">({ value: 0, units: "frequency" });
  const jitter = () => 0.85 + Math.random() * 0.3;
  const wow = new Tone.LFO({ frequency: m.wow.rate * jitter(), min: -m.wow.cents, max: m.wow.cents, phase: Math.random() * 360 });
  const flutter = new Tone.LFO({ frequency: m.flutter.rate * jitter(), min: -m.flutter.cents, max: m.flutter.cents });
  const nodes: { dispose: () => void }[] = [out, tapeEnd, highpass, nasal, lowpass, envelope, frequency, wow, flutter];
  const oscillators = m.detunes.map((cents) => {
    const scale = new Tone.Multiply(2 ** (cents / 1200));
    const osc = new Tone.Oscillator({ type: "sawtooth", frequency: 0 }).connect(envelope);
    frequency.chain(scale, osc.frequency);
    wow.connect(osc.detune);
    flutter.connect(osc.detune);
    nodes.push(scale, osc);
    return osc;
  });
  const noise = new Tone.Noise("pink");
  const hissFilter = new Tone.Filter({ type: "bandpass", frequency: 4000, Q: 0.7 });
  const hissLevel = new Tone.Gain(m.hiss);
  noise.chain(hissFilter, hissLevel, envelope);
  nodes.push(noise, hissFilter, hissLevel);

  return {
    frequency,
    triggerAttack: (freq, time, velocity) => {
      frequency.setValueAtTime(freq, time);
      for (const osc of oscillators) osc.start(time);
      noise.start(time);
      wow.start(time);
      flutter.start(time);
      envelope.triggerAttack(time, velocity);
      if (limited) tapeEnd.gain.setValueAtTime(1, time + m.limit - m.ending).linearRampToValueAtTime(0, time + m.limit);
    },
    triggerRelease: (time) => envelope.triggerRelease(time),
    dispose: () => {
      for (const node of nodes) node.dispose();
    },
    release: m.release,
  };
}
