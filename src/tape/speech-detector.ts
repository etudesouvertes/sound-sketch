// 話し声か音楽かを、音の特徴から見分ける（ラジオの音楽を録らないため）。
// 16 kHz ほどに間引いた音を 20 ms ごとに区切り、2 秒分の特徴をまとめて、話し声らしさを 0〜1 で出す。
// 特徴（どれも話し声と音楽で傾向が違う）:
// - 静かな区切りの割合（話し声は言葉の切れ目で小さくなる）
// - ゼロ交差の多い区切りの割合（話し声は「さ」「し」のような子音で一瞬増える）
// - 大きさの変わり方（話し声は 1 秒に 4 回ほど上下する）
// - スペクトルの安定度（音楽の音は数百 ms 同じ高さが続き、話し声は絶えず変わる）
// - 拍（音の立ち上がりが一定の間隔で来るか。ラップのように声が話し声に近い音楽を見分ける）
// - 低音の量（音楽はベースやバスドラムで低音が多い）
// 重み (MODEL) は、世界のラジオ 110 局の録音に音分類モデル (YAMNet) で付けた「話し声 / 音楽」に合わせて学習したもの。
// 学習に使わなかった局で測ると、2 秒ごとに話し声の 93% を話し声、音楽の 92% を音楽と判断した

const RATE = 16000; // 間引いた後のおおよその標本化周波数
const N = 512; // FFT の長さ
const LO_HZ = 200; // スペクトルを見る範囲
const HI_HZ = 4000;
export const FRAME_SECONDS = 0.02;
export const WINDOW_FRAMES = 100; // 2 秒
const LAGS = [10, 25]; // スペクトルを比べる間隔（区切りの数。200 ms と 500 ms）
const SMOOTH = 8; // ピークの形だけ残すために、前後この数のビンの平均を引く
const BASS_HZ = 150; // これより下を低音とする
const BEAT_LAGS = [15, 50]; // 拍を探す間隔（区切りの数。0.3〜1 秒）

// 特徴の名前（学習と重みの並びをそろえるため）
export const FEATURE_NAMES = ["quiet", "zcrPeaks", "loudnessMove", "mod4Hz", "same200", "same500", "sameSpread", "flux", "beat", "bass"];

// 学習で求めた、特徴の平均・ばらつき・重み・切片
export const MODEL = {
  mean: [0.106, 0.134, 1.787, 0.495, 0.211, 0.163, 0.156, 1.303, 0.419, -0.727],
  scale: [0.133, 0.07, 1.058, 0.188, 0.145, 0.13, 0.042, 0.097, 0.172, 0.926],
  weights: [0.489, 0.09, 1.125, -0.241, -1.068, -1.066, -0.512, 0.206, -1.042, -0.626],
  bias: -2.299,
};

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(step * k);
        const s = Math.sin(step * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * c - im[b] * s;
        const xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

function correlation(a: Float64Array, b: Float64Array) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb + 1e-12);
}

type Frame = { rms: number; zcr: number; same: number[]; flux: number; onset: number; bass: number };

export class SpeechDetector {
  private factor: number; // 間引く割合
  private hop: number;
  private acc = 0; // 間引くための足し合わせ
  private accCount = 0;
  private ring: Float64Array; // 間引いた音の最後の N 個
  private ringPos = 0;
  private sinceFrame = 0;
  private window: Float64Array;
  private lo: number;
  private hi: number;
  private bassBin: number;
  private lastLog: Float64Array | null = null; // 前の区切りの対数スペクトル（低音から）
  private spectra: Float64Array[] = []; // 最近のスペクトル（最大の間隔の分だけ）
  private frames: Frame[] = [];
  private re = new Float64Array(N);
  private im = new Float64Array(N);

  constructor(sampleRate: number) {
    this.factor = Math.max(1, Math.round(sampleRate / RATE));
    const rate = sampleRate / this.factor;
    this.hop = Math.round(FRAME_SECONDS * rate);
    this.ring = new Float64Array(N);
    this.window = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    this.lo = Math.round((LO_HZ / rate) * N);
    this.hi = Math.round((HI_HZ / rate) * N);
    this.bassBin = Math.round((BASS_HZ / rate) * N);
  }

  reset() {
    this.spectra = [];
    this.frames = [];
    this.lastLog = null;
  }

  // 音を足す。区切りがそろうたびに、区切りの特徴を覚える
  push(samples: Float32Array) {
    for (let i = 0; i < samples.length; i++) {
      this.acc += samples[i];
      if (++this.accCount < this.factor) continue;
      this.ring[this.ringPos] = this.acc / this.factor;
      this.ringPos = (this.ringPos + 1) % N;
      this.acc = 0;
      this.accCount = 0;
      if (++this.sinceFrame >= this.hop) {
        this.sinceFrame = 0;
        this.analyzeFrame();
      }
    }
  }

  private analyzeFrame() {
    const { re, im, ring, hop } = this;
    let energy = 0;
    let crossings = 0;
    let previous = 0;
    for (let i = 0; i < N; i++) {
      const x = ring[(this.ringPos + i) % N];
      re[i] = x * this.window[i];
      im[i] = 0;
      // 大きさとゼロ交差は、新しい 1 区切り分だけで数える
      if (i >= N - hop) {
        energy += x * x;
        if (i > N - hop && x >= 0 !== previous >= 0) crossings++;
      }
      previous = x;
    }
    fft(re, im);
    // 低音から上の端までの対数パワー
    const full = new Float64Array(this.hi);
    let bassPower = 0;
    let restPower = 0;
    for (let k = 1; k < this.hi; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      full[k] = Math.log(power + 1e-10);
      if (k < this.bassBin) bassPower += power;
      else restPower += power;
    }
    // 音の立ち上がり（前の区切りより大きくなった分）
    let onset = 0;
    if (this.lastLog) for (let k = 1; k < this.hi; k++) onset += Math.max(0, full[k] - this.lastLog[k]);
    onset /= this.hi - 1;
    this.lastLog = full;
    const size = this.hi - this.lo;
    const log = full.subarray(this.lo, this.hi);
    const shape = new Float64Array(size);
    for (let k = 0; k < size; k++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, k - SMOOTH); j < Math.min(size, k + SMOOTH + 1); j++) {
        sum += log[j];
        count++;
      }
      shape[k] = log[k] - sum / count;
    }
    const spectra = this.spectra;
    const same = LAGS.map((lag) => (spectra.length >= lag ? correlation(shape, spectra[spectra.length - lag]) : NaN));
    let flux = NaN;
    if (spectra.length > 0) {
      const last = spectra[spectra.length - 1];
      flux = 0;
      for (let k = 0; k < size; k++) flux += Math.abs(shape[k] - last[k]);
      flux /= size;
    }
    spectra.push(shape);
    if (spectra.length > LAGS[LAGS.length - 1]) spectra.shift();
    const bass = Math.log10((bassPower + 1e-10) / (restPower + 1e-10));
    this.frames.push({ rms: Math.sqrt(energy / hop), zcr: crossings, same, flux, onset, bass });
    if (this.frames.length > WINDOW_FRAMES) this.frames.shift();
  }

  // 最近 2 秒の特徴。まだそろっていない、または無音なら null
  features(): number[] | null {
    const f = this.frames;
    if (f.length < WINDOW_FRAMES || f.some((a) => a.same.some(Number.isNaN))) return null;
    const meanRms = f.reduce((s, a) => s + a.rms, 0) / f.length;
    if (meanRms < 1e-4) return null;
    const meanZcr = f.reduce((s, a) => s + a.zcr, 0) / f.length;
    const quiet = f.filter((a) => a.rms < 0.5 * meanRms).length / f.length;
    const zcrPeaks = f.filter((a) => a.zcr > 1.5 * meanZcr).length / f.length;
    const loud = f.map((a) => 20 * Math.log10(a.rms + 1e-6));
    let loudnessMove = 0;
    for (let i = 1; i < loud.length; i++) loudnessMove += Math.abs(loud[i] - loud[i - 1]);
    loudnessMove /= loud.length - 1;
    // 大きさの揺れのうち、2〜8 Hz（言葉の速さ）の割合
    const meanLoud = loud.reduce((s, a) => s + a, 0) / loud.length;
    let band = 0;
    let total = 0;
    for (let k = 1; k < loud.length / 2; k++) {
      let c = 0;
      let s = 0;
      for (let i = 0; i < loud.length; i++) {
        const angle = (2 * Math.PI * k * i) / loud.length;
        c += (loud[i] - meanLoud) * Math.cos(angle);
        s += (loud[i] - meanLoud) * Math.sin(angle);
      }
      const power = c * c + s * s;
      const hz = k / (loud.length * FRAME_SECONDS);
      total += power;
      if (hz >= 2 && hz <= 8) band += power;
    }
    const mod4Hz = total > 0 ? band / total : 0;
    const same200 = f.reduce((s, a) => s + a.same[0], 0) / f.length;
    const same500 = f.reduce((s, a) => s + a.same[1], 0) / f.length;
    const sameSpread = Math.sqrt(f.reduce((s, a) => s + (a.same[0] - same200) ** 2, 0) / f.length);
    const flux = f.reduce((s, a) => s + a.flux, 0) / f.length;
    // 立ち上がりの自己相関の、0.3〜1 秒の間隔での一番高い値（一定の拍があるほど高い）
    const onsets = f.map((a) => a.onset);
    const meanOnset = onsets.reduce((s, a) => s + a, 0) / onsets.length;
    const centered = onsets.map((a) => a - meanOnset);
    const zero = centered.reduce((s, a) => s + a * a, 0) / centered.length;
    let beat = 0;
    for (let lag = BEAT_LAGS[0]; lag <= BEAT_LAGS[1]; lag++) {
      let sum = 0;
      for (let i = lag; i < centered.length; i++) sum += centered[i] * centered[i - lag];
      beat = Math.max(beat, sum / (centered.length - lag) / (zero + 1e-12));
    }
    const bass = f.reduce((s, a) => s + a.bass, 0) / f.length;
    return [quiet, zcrPeaks, loudnessMove, mod4Hz, same200, same500, sameSpread, flux, beat, bass];
  }

  // 話し声らしさ (0〜1)。判断できないときは null
  speech(): number | null {
    const x = this.features();
    if (!x) return null;
    let z = MODEL.bias;
    for (let i = 0; i < x.length; i++) z += (MODEL.weights[i] * (x[i] - MODEL.mean[i])) / MODEL.scale[i];
    return 1 / (1 + Math.exp(-z));
  }
}
