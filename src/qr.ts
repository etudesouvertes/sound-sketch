import "./qr.css";
import qrcode from "qrcode-generator";
import { onLangChange, tk } from "./i18n";

// 「QR」ボタン。押すと、スマホで開くための QR コードを画面の中央に出す。
// はじめは今のページの URL（スケールなどの設定を含む）。「トップページ」にも切り替えられ、設定を含めるかも選べる。
// 開発サーバーを localhost で開いているときは、同じ Wi-Fi のスマホで開けるよう、LAN の URL にする
// （LAN のアドレスは、ブラウザからは分からないので、開発サーバーの環境変数 LAN_HOST で渡す。vite.config.ts）

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

type Target = "page" | "home";

// QR に入れる URL
function qrUrl(target: Target, withSettings: boolean): string {
  const url = new URL(target === "home" ? "./" : location.href, location.href);
  url.hash = "";
  // みんなで鳴らす楽譜（Radio の score）は、設定を含めなくても渡す。パート（part）は端末ごとなので渡さない
  const score = url.searchParams.get("score");
  if (target === "home" || !withSettings) url.search = "";
  if (target === "page" && score) url.searchParams.set("score", score);
  url.searchParams.delete("part");
  if (LOCAL_HOSTS.includes(url.hostname) && __LAN_HOST__) url.hostname = __LAN_HOST__;
  return url.toString();
}

// QR コードを SVG で描く。黒い升目を 1 つのパスにまとめ、周りに 4 升分の白い余白を置く
function qrSvg(text: string): SVGSVGElement {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;
  const size = count + margin * 2;
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  const background = document.createElementNS(ns, "rect");
  background.setAttribute("width", String(size));
  background.setAttribute("height", String(size));
  background.setAttribute("fill", "#fff");
  const dark = document.createElementNS(ns, "path");
  dark.setAttribute("d", path);
  dark.setAttribute("fill", "#000");
  svg.append(background, dark);
  return svg;
}

export function setupQr() {
  const actions = document.querySelector(".bar-actions");
  if (!actions) return;
  const isHome = document.querySelector(".home") !== null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "qr-toggle";
  button.id = "qr";
  button.textContent = "QR";
  button.setAttribute("aria-haspopup", "dialog");
  actions.prepend(button);

  const backdrop = document.createElement("div");
  backdrop.className = "qr-backdrop";
  backdrop.hidden = true;
  const dialog = document.createElement("div");
  dialog.className = "qr-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  backdrop.append(dialog);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "qr-close";
  close.textContent = "×";
  const title = document.createElement("p");
  title.className = "qr-title";
  const code = document.createElement("div");
  code.className = "qr-code";
  const link = document.createElement("a");
  link.className = "qr-url";
  link.target = "_blank";
  link.rel = "noopener";
  const note = document.createElement("p");
  note.className = "qr-note";

  // このページ / トップページ（トップページでは切り替えを出さない）
  const choices = document.createElement("div");
  choices.className = "qr-choices";
  const targetButtons = (["page", "home"] as const).map((target) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.target = target;
    choices.append(b);
    return b;
  });
  const settingsLabel = document.createElement("label");
  settingsLabel.className = "qr-settings";
  const settingsBox = document.createElement("input");
  settingsBox.type = "checkbox";
  settingsBox.checked = true;
  const settingsText = document.createElement("span");
  settingsLabel.append(settingsBox, settingsText);

  dialog.append(close, title, code, link, note);
  if (!isHome) dialog.append(choices, settingsLabel);
  document.body.append(backdrop);

  let target: Target = isHome ? "home" : "page";

  const render = () => {
    const url = qrUrl(target, settingsBox.checked);
    code.replaceChildren(qrSvg(url));
    link.href = url;
    link.textContent = url;
    title.textContent = tk("qr.title");
    button.setAttribute("aria-label", tk("qr.title"));
    close.setAttribute("aria-label", tk("qr.close"));
    for (const b of targetButtons) {
      b.textContent = tk(b.dataset.target === "home" ? "qr.home" : "qr.page");
      b.setAttribute("aria-pressed", String(b.dataset.target === target));
    }
    settingsText.textContent = tk("qr.withSettings");
    // 設定を含めるかは、このページのときで、URL に設定があるときだけ選べる
    settingsLabel.hidden = target === "home" || location.search === "";
    const local = LOCAL_HOSTS.includes(location.hostname);
    note.textContent = local ? tk(__LAN_HOST__ ? "qr.lan" : "qr.noLan") : "";
    note.hidden = !local;
  };

  const open = () => {
    render(); // 開くたびに作り直す（設定を変えると URL も変わるため）
    backdrop.hidden = false;
    close.focus();
  };
  const hide = () => {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    button.focus({ preventScroll: true });
  };

  button.addEventListener("click", open);
  close.addEventListener("click", hide);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hide();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  for (const b of targetButtons) {
    b.addEventListener("click", () => {
      target = b.dataset.target as Target;
      render();
    });
  }
  settingsBox.addEventListener("change", render);
  onLangChange(() => {
    if (!backdrop.hidden) render();
  });
  render();
}
