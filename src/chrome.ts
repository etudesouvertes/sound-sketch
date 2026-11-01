import { tk } from "./i18n";

// キャンバスのページの、上のバーと設定パネル。
// 「⚙ 設定」でパネルを開閉し、パネルの「×」や Esc でも閉じる。パネルを開いたままでもキャンバスで演奏できる。
// 演奏が始まったあと、バーとパネルを 3 秒操作しないとバーが隠れ、隅の「≡」で戻す（PC もスマホも同じ操作）。
// キャンバスのクリックは演奏なので、バーを出しておく理由にはしない。H キーでも出し入れできる

const HIDE_AFTER_MS = 3000;

export function setupChrome() {
  const bar = document.querySelector<HTMLElement>(".bar")!;
  const toggle = document.querySelector<HTMLButtonElement>("#settings-toggle")!;
  const panel = document.querySelector<HTMLElement>("#settings")!;
  const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;

  const show = document.createElement("button");
  show.type = "button";
  show.className = "chrome-show";
  show.textContent = "≡";
  show.dataset.i18nAria = "showMenu";
  show.setAttribute("aria-label", tk("showMenu"));
  document.body.append(show);

  let started = false;
  let hovering = false;
  let timer: number | undefined;

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    restart();
  };

  const setHidden = (hidden: boolean) => {
    document.body.classList.toggle("chrome-hidden", hidden);
    if (!hidden) restart();
  };

  // 隠さないとき: パネル（設定、Sonata の作曲家）が開いている、バーの上にマウスがある、キーボードでバーのボタンにフォーカスがある、
  // 録音中、説明を表示している。マウスで押したあとに残るフォーカスは :focus-visible に当たらないので、
  // クリアや設定を押したあとはこれまでどおり隠れる
  const busy = () =>
    !panel.hidden ||
    document.querySelector(".composer-panel:not([hidden])") !== null ||
    hovering ||
    bar.querySelector(":focus-visible") !== null ||
    document.querySelector("button.recording") !== null ||
    document.querySelector(".help-popover.open, .help-sheet.open") !== null;

  function restart() {
    clearTimeout(timer);
    if (!started) return;
    timer = setTimeout(() => {
      if (busy()) restart();
      else setHidden(true);
    }, HIDE_AFTER_MS);
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  document.querySelector("#settings-close")!.addEventListener("click", () => setOpen(false));
  show.addEventListener("click", () => setHidden(false));

  // バーとパネルの操作で、隠れるまでの時間を数え直す
  for (const el of [bar, panel]) {
    for (const type of ["pointerdown", "pointermove", "keydown", "focusin", "wheel"]) {
      el.addEventListener(type, restart, { passive: true });
    }
  }
  bar.addEventListener("pointerenter", () => (hovering = true));
  bar.addEventListener("pointerleave", () => {
    hovering = false;
    restart();
  });

  // 最初の演奏（キャンバスのクリック）から数え始める。キャンバス以外（Sonata の再生のボタンなど）で演奏を始めたときは、
  // ページが document に "performance-start" を送る
  const start = () => {
    if (started) return;
    started = true;
    restart();
  };
  canvas.addEventListener("pointerdown", start);
  document.addEventListener("performance-start", start);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if (!typing && !e.repeat && (e.key === "h" || e.key === "H")) {
      setHidden(!document.body.classList.contains("chrome-hidden"));
    }
  });
}
