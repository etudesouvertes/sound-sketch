// Tape の逆再生。テープに書いた音を覚えておき、1 周ごとの区切りから、直前の 1 周分を逆向きに読み出す。
// 区切りの時刻 T から T + 1 周 の間は、時刻 t に、T - (t - T) に書いた音を鳴らす（区切りを鏡にして折り返す）。
// 区切りの前後は短くフェードして、つなぎ目でプチッと鳴らないようにする

// AudioWorkletGlobalScope の型は DOM の lib に含まれないので、使う分だけ宣言する
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;

// 区切りの 1 つの時刻 (AudioContext の秒) と、1 周の長さ (秒)
export type ReverseMessage = { start: number; length: number };

const HISTORY = 42; // 覚えておく長さ (秒)。1 周の長さの上限 (20 秒) の 2 倍より少し長く
const FADE = 0.01; // 区切りの前後でフェードする長さ (秒)

class ReverseProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(Math.ceil(HISTORY * sampleRate));
  private start = 0; // 区切りの 1 つ (サンプル)
  private length = 7 * sampleRate; // 1 周 (サンプル)

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ReverseMessage>) => {
      this.start = e.data.start * sampleRate;
      this.length = e.data.length * sampleRate;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const input = inputs[0][0];
    const output = outputs[0][0];
    const size = this.buffer.length;
    const fade = FADE * sampleRate;
    for (let i = 0; i < output.length; i++) {
      const t = currentFrame + i;
      this.buffer[t % size] = input ? input[i] : 0;
      const turn = Math.round(this.start + Math.floor((t - this.start) / this.length) * this.length);
      const into = t - turn;
      const from = turn - into;
      const gain = Math.min(1, into / fade, (this.length - into) / fade);
      output[i] = from >= 0 && gain > 0 ? this.buffer[from % size] * gain : 0;
    }
    return true;
  }
}

registerProcessor("tape-reverse", ReverseProcessor);
