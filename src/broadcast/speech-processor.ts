// ラジオの音が話し声か音楽かを見分ける AudioWorklet。音は出さず、0.5 秒ごとに話し声らしさを送る
import { SpeechDetector } from "./speech-detector";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;

// 話し声らしさ (0〜1)。無音や、局を変えた直後で判断できないときは null
export type SpeechMessage = { speech: number | null };

const REPORT_SECONDS = 0.5;

class SpeechProcessor extends AudioWorkletProcessor {
  private detector = new SpeechDetector(sampleRate);
  private sinceReport = 0;

  constructor() {
    super();
    // 何か届いたら（局を変えたとき）、覚えた音を捨てる
    this.port.onmessage = () => this.detector.reset();
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0][0];
    if (!input) return true;
    this.detector.push(input);
    this.sinceReport += input.length;
    if (this.sinceReport >= REPORT_SECONDS * sampleRate) {
      this.sinceReport = 0;
      const message: SpeechMessage = { speech: this.detector.speech() };
      this.port.postMessage(message);
    }
    return true;
  }
}

registerProcessor("speech-detector", SpeechProcessor);
