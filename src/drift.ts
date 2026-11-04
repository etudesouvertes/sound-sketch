import { getLang } from "./i18n";

// 経過時間でゆっくり動く「指揮者」。各値の周期を割り切れない長さにして、
// 同じ重なり方がほとんど二度と来ないようにする（イーノのテープループと同じ考え方）。

export type Drift = {
  register: number; // 音域。-1（低い）〜1（高い）
  density: number; // 自動で置かれる音の多さ。-1〜1
  brightness: number; // FM の変調の深さ。-1（柔らかい）〜1（金属的）
  reverb: number; // リバーブの深さ。-1〜1
};

export const NEUTRAL_DRIFT: Drift = { register: 0, density: 0, brightness: 0, reverb: 0 };

const MINUTE = 60;
const MODULATION_PERIOD = 20 * MINUTE; // 5 度上へ転調する間隔
const PERIODS: Record<keyof Drift, number> = {
  reverb: 7 * MINUTE,
  density: 11 * MINUTE,
  brightness: 13 * MINUTE,
  register: 17 * MINUTE,
};
const TICK_MS = 1000;

export const densityFactor = (d: Drift) => 2 ** (0.6 * d.density);

function formatTime(seconds: number): string {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// 変化スイッチがオンの間、1 秒ごとに経過時間を進めて apply に渡し、転調の時刻が来たら modulate を呼ぶ（modulate がなければ転調しない）。
// 速さ（×1 / ×10 / ×60）は経過時間の進み方だけを変える
export function setupDrift(
  toggleEl: HTMLInputElement,
  speedEl: HTMLSelectElement,
  statusEl: HTMLElement,
  handlers: { apply: (drift: Drift | null) => void; modulate?: () => void; root: () => string },
) {
  let elapsed = 0;
  let timer: number | undefined;

  const tick = () => {
    const speed = Number(speedEl.value);
    const before = Math.floor(elapsed / MODULATION_PERIOD);
    elapsed += (speed * TICK_MS) / 1000;
    if (Math.floor(elapsed / MODULATION_PERIOD) > before) handlers.modulate?.();

    const drift = Object.fromEntries(
      Object.entries(PERIODS).map(([key, period]) => [key, Math.sin((2 * Math.PI * elapsed) / period)]),
    ) as Drift;
    handlers.apply(drift);

    const remain = (MODULATION_PERIOD - (elapsed % MODULATION_PERIOD)) / speed;
    // 1 秒ごとに書き直すので、言語を切り替えても次の更新で新しい言語になる
    const ja = getLang() === "ja";
    statusEl.textContent = !handlers.modulate
      ? `${ja ? "主音" : "Root"} ${handlers.root()}`
      : ja
        ? `主音 ${handlers.root()} · 次の転調まで ${formatTime(remain)}`
        : `Root ${handlers.root()} · next key change in ${formatTime(remain)}`;
  };

  toggleEl.addEventListener("change", () => {
    clearInterval(timer);
    if (toggleEl.checked) {
      elapsed = 0;
      tick();
      timer = setInterval(tick, TICK_MS);
    } else {
      statusEl.textContent = "";
      handlers.apply(null);
    }
  });
}
