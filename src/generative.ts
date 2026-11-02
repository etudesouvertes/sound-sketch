import * as Tone from "tone";
import { protectOutput } from "./audio";
import { setupChrome } from "./chrome";
import { type Drift, densityFactor, NEUTRAL_DRIFT, setupDrift } from "./drift";
import { setupHelp } from "./help";
import { setupI18n } from "./i18n";
import { densityLevelFactor, registerOffset, setupLevel } from "./levels";
import { clamp01 } from "./math";
import { type FreeScale, type Pitch, setupScalePicker, visiblePitches } from "./scales";
import { type Mood, NEUTRAL_MOOD, setupWeather } from "./weather";

// Ripples / Phase / Loops に共通の土台。
// スケール・主音・音域・密度・天気・変化をつなぎ、画面に割り当てる音高と、ページ固有の音（テンポ・リバーブ・音色など）を更新する。
// 音域は「段階 + 変化の揺れ」、自動で置く頻度は「天気 × 変化 × 密度の段階」で決まる

export type SoundParams = {
  mood: Omit<Mood, "icon">; // 天気（オフのときは標準値）
  drift: Drift; // 変化（オフのときは標準値）
  ramp: number; // 値を移す時間 (秒)
};

// リバーブの深さ。ページごとの基準値に、雲の量と変化の揺れを足す
export function reverbWet(base: number, { mood, drift }: SoundParams): number {
  return clamp01(base + 0.5 * mood.wetness + 0.15 * drift.reverb);
}

export function setupGenerativePage(options: {
  defaults: { scale: string; root: string };
  freeScale?: FreeScale; // スケールの先頭に足す「指定しない」の選択肢
  // 天気・変化の値が変わったときに、ページ固有の音に反映する
  applyParams: (params: SoundParams) => void;
}) {
  protectOutput();
  setupI18n();
  setupChrome();
  setupHelp();

  const hintEl = document.querySelector<HTMLElement>("#hint")!;
  const transport = Tone.getTransport();

  let weather: Mood | null = null;
  let drift: Drift | null = null;
  let allPitches: Pitch[] = [];
  let pitches: Pitch[] = [];

  const updatePitches = () => {
    pitches = visiblePitches(allPitches, registerOffset(registerLevel) + (drift ?? NEUTRAL_DRIFT).register);
  };

  let registerLevel = setupLevel(
    document.querySelector<HTMLInputElement>("#register")!,
    document.querySelector<HTMLOutputElement>("#register-value")!,
    "register",
    (level) => {
      registerLevel = level;
      updatePitches();
    },
  );
  let densityLevel = setupLevel(
    document.querySelector<HTMLInputElement>("#density")!,
    document.querySelector<HTMLOutputElement>("#density-value")!,
    "density",
    (level) => (densityLevel = level),
  );
  const scalePicker = setupScalePicker(
    document.querySelector<HTMLSelectElement>("#scale")!,
    document.querySelector<HTMLSelectElement>("#root")!,
    options.defaults,
    (next) => {
      allPitches = next;
      updatePitches();
    },
    options.freeScale,
  );
  allPitches = scalePicker.pitches;
  updatePitches();

  const apply = (ramp: number) => {
    options.applyParams({ mood: weather ?? NEUTRAL_MOOD, drift: drift ?? NEUTRAL_DRIFT, ramp });
  };

  setupWeather(
    document.querySelector<HTMLInputElement>("#weather")!,
    document.querySelector<HTMLSelectElement>("#place")!,
    document.querySelector<HTMLElement>("#weather-status")!,
    (next) => {
      weather = next;
      apply(4);
    },
  );

  setupDrift(
    document.querySelector<HTMLInputElement>("#drift")!,
    document.querySelector<HTMLSelectElement>("#drift-speed")!,
    document.querySelector<HTMLElement>("#drift-status")!,
    {
      apply: (next) => {
        drift = next;
        apply(1);
        updatePitches(); // 音域は変化でも揺れる（天気では変わらない）
      },
      modulate: () => scalePicker.transposeRoot(7),
      root: scalePicker.root,
    },
  );

  let started = false;
  let starting: Promise<void> | null = null;

  // 最初の操作で音を出せる状態にし、ヒントを消す。
  // 音を出せなかったとき（ブラウザが許可しないなど）は、次の操作でもう一度試す
  const ensureStarted = (): Promise<void> => {
    starting ??= (async () => {
      try {
        await Tone.start();
      } catch (e) {
        console.warn(e);
      }
      if (Tone.getContext().state !== "running") {
        starting = null;
        return;
      }
      started = true;
      transport.start();
      hintEl.classList.add("hidden");
    })();
    return starting;
  };

  // iPhone などのタッチ操作では、触れた瞬間（pointerdown）は音を出す許可にならず、指を離したとき（pointerup）に許可される。
  // 触れた瞬間の ensureStarted が許可を待っているあいだに、ここで改めて頼む
  document.addEventListener("pointerup", () => {
    if (started) return;
    Tone.start().catch(() => {}); // 失敗は ensureStarted の側で扱う
    void ensureStarted();
  });

  // iPhone の消音スイッチがオンでも鳴らす（音楽を聴くページとして扱ってもらう。対応していないブラウザでは何もしない）
  const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (audioSession) audioSession.type = "playback";

  return {
    transport,
    // 画面に割り当てている音高（低い順）
    pitches: () => pitches,
    weatherOn: () => weather !== null,
    // 天気（オフのときは標準値）
    mood: () => weather ?? NEUTRAL_MOOD,
    // 密度の段階による頻度の倍率
    densityLevelFactor: () => densityLevelFactor(densityLevel),
    // 自動で置く頻度の倍率
    autoDensity: () =>
      (weather ?? NEUTRAL_MOOD).density * densityFactor(drift ?? NEUTRAL_DRIFT) * densityLevelFactor(densityLevel),
    // 「指定しない」の音階が変わったときに、音高を作り直す
    refreshScale: scalePicker.refresh,
    started: () => started,
    ensureStarted,
  };
}

// キャンバスを画面いっぱいにし、高解像度の画面でもにじまないようにする。大きさが変わるたびに onResize を呼ぶ
export function setupCanvas(
  canvas: HTMLCanvasElement,
  onResize: (width: number, height: number) => void,
): CanvasRenderingContext2D {
  const g = canvas.getContext("2d")!;
  // 表示の大きさも、描く大きさ（innerWidth・innerHeight）に合わせる。CSS の 100vh は、スマホではブラウザのツールバーを
  // 隠したときの高さになり、見えている高さより大きい。そのままだと絵が縦に引き伸ばされ、下の端がツールバーの裏に隠れる
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", resize);
  resize();
  return g;
}
