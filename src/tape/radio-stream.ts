// ラジオの放送を、<audio> を使わずに受け取って Web Audio で鳴らす。
// iPhone の Safari（と、同じ WebKit の Edge・Chrome）では、終わりのない配信を <audio> から Web Audio に取り出せず、
// スピーカーへ直接鳴ってしまう。そこで、放送のデータを fetch で読み、MP3 / AAC のフレームの切れ目で 1〜2 秒ずつに切って
// decodeAudioData で音に戻し、順に並べて鳴らす。
// 塊の頭は、前の塊の終わりのフレームを少し足してから音に戻し、足した分は捨てる（デコーダーの立ち上がりで、切れ目が途切れないように）

import * as Tone from "tone";

const CHUNK_SECONDS = 1.5; // 一度に音に戻す長さ
const PREROLL_FRAMES = 4; // 塊の頭に足す、前の塊のフレームの数
const START_AHEAD = 0.3; // 最初の塊を、今からどれだけ先に鳴らすか (秒)
const MAX_SEARCH = 64 * 1024; // フレームの頭が見つからないまま、これだけ読んだら諦める (バイト)
const MAX_FAILURES = 3; // 音に戻せない塊がこれだけ続いたら諦める（ブラウザがその形式に対応していないなど）

type Frame = { bytes: Uint8Array; samples: number; rate: number };

const MP3_BITRATES = {
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = [44100, 48000, 32000];
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

// data[i] から始まるフレームの長さ・標本数・標本化周波数。フレームの頭でなければ null
function frameAt(data: Uint8Array, i: number): { length: number; samples: number; rate: number } | null {
  if (i + 7 > data.length || data[i] !== 0xff) return null;
  const b1 = data[i + 1];
  // AAC (ADTS): 0xFFF で始まり、layer が 0
  if ((b1 & 0xf6) === 0xf0) {
    const rateIndex = (data[i + 2] >> 2) & 0x0f;
    const length = ((data[i + 3] & 0x03) << 11) | (data[i + 4] << 3) | (data[i + 5] >> 5);
    if (rateIndex >= AAC_RATES.length || length < 7) return null;
    return { length, samples: 1024, rate: AAC_RATES[rateIndex] };
  }
  // MP3 (MPEG-1 / 2 / 2.5 Layer III)
  if ((b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b1 >> 1) & 0x03; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrateIndex = data[i + 2] >> 4;
  const rateIndex = (data[i + 2] >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const padding = (data[i + 2] >> 1) & 0x01;
  const v1 = version === 3;
  const bitrate = (v1 ? MP3_BITRATES.v1l3 : MP3_BITRATES.v2l3)[bitrateIndex] * 1000;
  const rate = MP3_RATES[rateIndex] / (v1 ? 1 : version === 2 ? 2 : 4);
  const samples = v1 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * bitrate) / rate) + padding;
  return { length, samples, rate };
}

export class RadioStream {
  readonly output: Tone.Gain;
  private controller: AbortController | null = null;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>(); // 鳴らす予定の塊（局を変えたら止める）
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.output = new Tone.Gain(1);
  }

  // 放送を受け取り始める。最初の音が鳴る準備ができたら true、できなかったら（CORS で断られた、形式が違う、時間切れ）false。
  // その後に放送が途切れたら onEnd を呼ぶ
  play(url: string, timeoutMs: number, onEnd: () => void): Promise<boolean> {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    return new Promise((resolve) => {
      let started = false;
      const timer = setTimeout(() => finish(false), timeoutMs);
      const finish = (ok: boolean) => {
        if (started) return;
        started = true;
        clearTimeout(timer);
        if (!ok) controller.abort();
        resolve(ok);
      };
      this.read(url, controller.signal, () => finish(true))
        .catch(() => {})
        .finally(() => {
          if (!started) finish(false);
          else if (!controller.signal.aborted) {
            // 受け取り終えても、先に並べた塊が鳴り終わるまで待ってから知らせる
            const context = Tone.getContext().rawContext;
            const left = Math.max(0, this.nextTime - context.currentTime);
            this.endTimer = setTimeout(() => {
              this.endTimer = null;
              if (!controller.signal.aborted) onEnd();
            }, left * 1000);
          }
        });
    });
  }

  stop() {
    this.controller?.abort();
    this.controller = null;
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    // 先に並べてある前の局の塊も止める
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // まだ始まっていない塊でも止められるが、念のため
      }
    }
    this.sources.clear();
  }

  private async read(url: string, signal: AbortSignal, onFirst: () => void) {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok || !response.body) throw new Error(`radio ${response.status}`);
    const reader = response.body.getReader();
    signal.addEventListener("abort", () => void reader.cancel().catch(() => {}));
    let pending = new Uint8Array(0); // まだフレームに切っていないデータ
    let total = 0; // 読んだ量 (バイト)
    let chunk: Frame[] = [];
    let chunkSamples = 0;
    let preroll: Frame[] = [];
    let first = true;
    let failures = 0;
    this.nextTime = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) return;
      total += value.length;
      const joined = new Uint8Array(pending.length + value.length);
      joined.set(pending);
      joined.set(value, pending.length);
      // フレームに切る。続くフレームの頭も確かめて、たまたま 0xFF が並んだところを頭と取り違えないようにする
      let i = 0;
      while (i < joined.length) {
        const frame = frameAt(joined, i);
        if (!frame) {
          i++;
          continue;
        }
        if (i + frame.length > joined.length) break;
        if (i + frame.length + 7 <= joined.length && !frameAt(joined, i + frame.length)) {
          i++;
          continue;
        }
        chunk.push({ bytes: joined.subarray(i, i + frame.length), samples: frame.samples, rate: frame.rate });
        chunkSamples += frame.samples;
        i += frame.length;
        if (chunkSamples / frame.rate >= CHUNK_SECONDS) {
          const ok = await this.decode(preroll, chunk, signal);
          if (signal.aborted) return;
          failures = ok ? 0 : failures + 1;
          if (failures >= MAX_FAILURES) throw new Error("radio: cannot decode");
          if (first && ok) {
            first = false;
            onFirst();
          }
          preroll = chunk.slice(-PREROLL_FRAMES);
          chunk = [];
          chunkSamples = 0;
        }
      }
      pending = joined.slice(i);
      if (first && chunk.length === 0 && total > MAX_SEARCH) throw new Error("radio: no frames");
    }
  }

  // 前の塊の終わり (preroll) を頭に足して音に戻し、足した分を捨てて、前の塊のすぐ後ろに鳴らす
  // 音に戻せたら true
  private async decode(preroll: Frame[], chunk: Frame[], signal: AbortSignal): Promise<boolean> {
    const frames = [...preroll, ...chunk];
    const size = frames.reduce((sum, f) => sum + f.bytes.length, 0);
    const data = new Uint8Array(size);
    let at = 0;
    for (const f of frames) {
      data.set(f.bytes, at);
      at += f.bytes.length;
    }
    const context = Tone.getContext().rawContext as AudioContext;
    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(data.buffer);
    } catch {
      return false; // 壊れた塊は飛ばす
    }
    if (signal.aborted) return true;
    const rate = chunk[0].rate;
    const seconds = chunk.reduce((sum, f) => sum + f.samples, 0) / rate;
    // 塊の分だけ、後ろから取る（デコーダーの遅れは、どの塊でも同じだけずれるので、つながりは保たれる）
    const keep = Math.min(buffer.length, Math.round(seconds * buffer.sampleRate));
    const offset = (buffer.length - keep) / buffer.sampleRate;
    const now = context.currentTime;
    if (this.nextTime < now + 0.05) this.nextTime = now + START_AHEAD; // 遅れたら（最初や、受け取りが詰まったとき）、少し先から鳴らし直す
    const source = context.createBufferSource();
    source.buffer = buffer;
    Tone.connect(source, this.output);
    source.start(this.nextTime, offset, keep / buffer.sampleRate);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    this.nextTime += keep / buffer.sampleRate;
    return true;
  }
}
