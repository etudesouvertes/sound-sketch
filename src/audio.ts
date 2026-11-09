import * as Tone from "tone";

// 出力の最後にリミッターを入れ、音が重なっても大きくなりすぎたり割れたりしないようにする。各ページで最初に 1 回呼ぶ
export function protectOutput() {
  Tone.getDestination().chain(new Tone.Limiter(-3));
}

const STEP_SECONDS = 0.05;

// PolySynth の声ごとの値（FM の明るさなど）は set でしか変えられず、そのままでは一気に切り替わる。
// 少しずつ set して、seconds 秒かけて移す関数を返す。前の移動が終わる前に呼ばれたら、今の値から新しい値へ移し直す
export function steppedRamp(initial: number, apply: (value: number) => void) {
  let value = initial;
  let timer: ReturnType<typeof setInterval> | undefined;
  return (target: number, seconds: number) => {
    clearInterval(timer);
    const from = value;
    const steps = Math.max(1, Math.round(seconds / STEP_SECONDS));
    let step = 0;
    const next = () => {
      step += 1;
      value = from + ((target - from) * step) / steps;
      apply(value);
      if (step >= steps) clearInterval(timer);
    };
    if (steps === 1) next();
    else timer = setInterval(next, STEP_SECONDS * 1000);
  };
}

// AudioWorklet は、安全な接続（https か localhost）でしか使えない。開発サーバーを LAN の http の URL で開くと使えない。
// 使えないときは、それを使う機能（Tape の逆再生、音楽と話し声の聞き分け）を止め、ページのほかの部分は動かす
export const workletsAvailable = (): boolean =>
  (Tone.getContext().rawContext as AudioContext).audioWorklet !== undefined;

// AudioWorklet のモジュールを読み込む。使えないときは失敗する Promise を返す
// （Tone の addAudioWorkletModule は最初の 1 モジュールしか読み込まないため、rawContext に直接登録する）
export function addWorkletModule(url: string): Promise<void> {
  const worklet = (Tone.getContext().rawContext as AudioContext).audioWorklet as AudioWorklet | undefined;
  return worklet ? worklet.addModule(url) : Promise.reject(new Error("AudioWorklet is not available here"));
}
