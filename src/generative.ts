import * as Tone from "tone";
import { protectOutput } from "./audio";
import { setupChrome } from "./chrome";
import { type Drift, densityFactor, NEUTRAL_DRIFT, setupDrift } from "./drift";
import { setupHelp } from "./help";
import { setupQr } from "./qr";
import { setupI18n } from "./i18n";
import { setupNav } from "./nav";
import { densityLevelFactor, registerOffset, setupLevel } from "./levels";
import { clamp01 } from "./math";
import { type Pitch, pitchesOf, type Scale, setupScalePicker, visiblePitches } from "./scales";
import { type Mood, NEUTRAL_MOOD, setupWeather } from "./weather";

// Ripples / Phase / Loops に共通の土台。
// スケール・主音・音域・密度・響き・天気・変化をつなぎ、画面に割り当てる音高と、リバーブと、ページ固有の音（テンポ・音色など）を更新する。
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

// 設定の「響き」（1〜5）。3 がページごとの標準の響きで、残響の長さは段階ごとに倍率を掛ける。
// 深さは、3 より下では標準の深さ（天気を使わないとき）を縮め（1 でほぼ響きなし）、上では足す（5 でホールのように深く）。
// 天気（雲）と変化は、ここで決まった深さを中心に揺らす
const REVERB_SCALES = [0.1, 0.55]; // 響き 1・2 の深さ（標準の何倍か）
const REVERB_ADDS = [0, 0.15, 0.3]; // 響き 3・4・5 で足す深さ
const reverbOffset = (wet: number, level: number) => {
  const standard = reverbWet(wet, { mood: NEUTRAL_MOOD, drift: NEUTRAL_DRIFT, ramp: 0 });
  return level < 3 ? standard * (REVERB_SCALES[level - 1] - 1) : REVERB_ADDS[level - 3];
};
const REVERB_DECAYS = [1.5, 2.5, 3.5, 5, 7].map((d) => d / 3.5);

export function setupGenerativePage(options: {
  defaults?: { scale: string; root: string }; // 設定のスケールと主音の初めの値（fixedScale のときは要らない）
  // ページが音階と主音を決めるとき（Sonata は作曲家ごと）。設定のスケールと主音は使わず、変化でも転調しない
  fixedScale?: () => { scale: Scale; root: string };
  // 天気・変化の値が変わったときに、ページ固有の音に反映する
  applyParams: (params: SoundParams) => void;
  // ページのリバーブと、響きが 3（標準）のときの深さ・残響の長さ。設定の「響き」・天気・変化で動かす
  reverb: { node: Tone.Reverb; wet: number; decay: number };
  // 設定の「音域」を、ほかのページと共通の register でなく、ページ専用の名前で URL に残すとき（初めの値も変えられる）
  register?: { param: string; initial: number };
}) {
  protectOutput();
  setupNav();
  setupI18n();
  setupQr();
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
    options.register?.param ?? "register",
    (level) => {
      registerLevel = level;
      updatePitches();
    },
    options.register?.initial,
  );
  let densityLevel = setupLevel(
    document.querySelector<HTMLInputElement>("#density")!,
    document.querySelector<HTMLOutputElement>("#density-value")!,
    "density",
    (level) => (densityLevel = level),
  );
  const fixed = options.fixedScale;
  const fixedPitches = () => {
    const { scale, root } = fixed!();
    allPitches = pitchesOf(scale, root);
    updatePitches();
  };
  const scalePicker = fixed
    ? null
    : setupScalePicker(
        document.querySelector<HTMLSelectElement>("#scale")!,
        document.querySelector<HTMLSelectElement>("#root")!,
        options.defaults!,
        (next) => {
          allPitches = next;
          updatePitches();
        },
      );
  if (scalePicker) {
    allPitches = scalePicker.pitches;
    updatePitches();
  } else fixedPitches();

  const applyReverb = (params: SoundParams) => {
    const { node, wet, decay } = options.reverb;
    node.wet.rampTo(reverbWet(wet + reverbOffset(wet, reverbLevel), params), params.ramp);
    const length = decay * REVERB_DECAYS[reverbLevel - 1];
    if (node.decay !== length) node.decay = length;
  };
  let reverbLevel = setupLevel(
    document.querySelector<HTMLInputElement>("#reverb")!,
    document.querySelector<HTMLOutputElement>("#reverb-value")!,
    "reverb",
    (level) => {
      reverbLevel = level;
      applyReverb({ mood: weather ?? NEUTRAL_MOOD, drift: drift ?? NEUTRAL_DRIFT, ramp: 0.5 });
    },
  );

  const apply = (ramp: number) => {
    const params = { mood: weather ?? NEUTRAL_MOOD, drift: drift ?? NEUTRAL_DRIFT, ramp };
    applyReverb(params);
    options.applyParams(params);
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
      modulate: scalePicker ? () => scalePicker.transposeRoot(7) : undefined,
      root: scalePicker ? scalePicker.root : () => fixed!().root,
    },
  );

  let started = false;
  let starting: Promise<void> | null = null;
  let requested = false; // この操作で、音を出し始めるよう頼まれたか（キャンバスを押した、Sonata の再生を押したなど）

  // 最初の操作で音を出せる状態にし、ヒントを消す。
  // 音を出せなかったとき（ブラウザが許可しないなど）は、次の操作でもう一度試す
  const ensureStarted = (): Promise<void> => {
    requested = true;
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
  // 触れた瞬間の ensureStarted が許可を待っているあいだに、ここで改めて頼む。
  // 音を出すよう頼まれていない操作（QR・設定などのボタン）では始めない
  document.addEventListener("pointerup", () => {
    if (started || !requested) return;
    Tone.start().catch(() => {}); // 失敗は ensureStarted の側で扱う
    void ensureStarted();
    requested = false; // 頼み直すのは 1 回の操作につき 1 回

  });

  // iPhone の消音スイッチがオンでも鳴らす（音楽を聴くページとして扱ってもらう。対応していないブラウザでは何もしない）
  const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (audioSession) audioSession.type = "playback";

  return {
    transport,
    // 画面に割り当てている音高（低い順）
    pitches: () => pitches,
    // 音域の段階 level（1〜5）で割り当てる音高（低い順）。設定の音域とは別の音域を持つ声（Tape のソロ）に使う
    pitchesFor: (level: number) =>
      visiblePitches(allPitches, registerOffset(level) + (drift ?? NEUTRAL_DRIFT).register),
    weatherOn: () => weather !== null,
    // 天気（オフのときは標準値）
    mood: () => weather ?? NEUTRAL_MOOD,
    // 密度の段階による頻度の倍率
    densityLevelFactor: () => densityLevelFactor(densityLevel),
    // 自動で置く頻度の倍率
    autoDensity: () =>
      (weather ?? NEUTRAL_MOOD).density * densityFactor(drift ?? NEUTRAL_DRIFT) * densityLevelFactor(densityLevel),
    // ページが決める音階と主音が変わったときに、音高を作り直す
    refreshScale: () => (scalePicker ? scalePicker.refresh() : fixedPitches()),
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
