import "./nav.css";
import { onLangChange, tk } from "./i18n";

// 上のバーのナビ。ページの一覧はここだけに書き、各ページの <nav class="nav"></nav> にこの一覧から組み立てる。
// まとまり（group）は「名前 ▾」のボタンになり、押すとバーの下にカードのパネルを開く（Sonata の作曲家のパネルと同じ操作）。
// まとまりの中のページにいるときは、ボタンに今のページの名前を出す。Esc や、パネルの外を押すと閉じる

type NavPage = { id: string; name: string; href: string; description?: string }; // description は i18n のキー
type NavGroup = { id: string; name: string; pages: NavPage[] };
type NavItem = NavPage | NavGroup;

const NAV: NavItem[] = [
  {
    id: "sketches",
    name: "Sketches",
    pages: [
      { id: "ripples", name: "Ripples", href: "./ripples.html", description: "home.ripples" },
      { id: "phase", name: "Phase", href: "./phase.html", description: "home.phase" },
      { id: "loops", name: "Loops", href: "./loops.html", description: "home.loops" },
      { id: "tape", name: "Tape", href: "./tape.html", description: "home.tape" },
      { id: "radio", name: "Radio", href: "./radio.html", description: "home.radio" },
    ],
  },
  { id: "sonata", name: "Sonata", href: "./sonata.html" },
  { id: "duo", name: "Duo", href: "./duo.html" },
];

// Keyboard は公開しない。開いているときだけナビに出す
const HIDDEN: NavPage[] = [{ id: "keyboard", name: "Keyboard", href: "./keyboard.html" }];

const isGroup = (item: NavItem): item is NavGroup => "pages" in item;

function currentPageId(): string {
  const name = location.pathname.split("/").pop() ?? "";
  return name.replace(/\.html$/, "");
}

function link(page: NavPage, current: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = page.href;
  a.textContent = page.name;
  if (page.id === current) a.setAttribute("aria-current", "page");
  return a;
}

function setupGroup(group: NavGroup, current: string): HTMLButtonElement {
  const here = group.pages.find((p) => p.id === current);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-group";
  button.textContent = `${here?.name ?? group.name} ▾`;
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-haspopup", "dialog");
  // まとまりの中のページにいるときは、このボタンが「今のページ」の印になる（説明の吹き出しもここに付く）
  if (here) button.setAttribute("aria-current", "page");

  const panel = document.createElement("div");
  panel.id = `nav-${group.id}`;
  panel.className = "nav-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", group.name);
  panel.hidden = true;
  button.setAttribute("aria-controls", panel.id);

  const heading = document.createElement("h2");
  heading.textContent = group.name;
  const cards = document.createElement("div");
  cards.className = "nav-cards";
  const descriptions: [HTMLElement, string][] = [];
  cards.append(
    ...group.pages.map((p) => {
      const a = link(p, current);
      a.className = "nav-card";
      a.replaceChildren();
      const name = document.createElement("strong");
      name.textContent = p.name;
      a.append(name);
      if (p.description) {
        const text = document.createElement("span");
        descriptions.push([text, p.description]);
        a.append(text);
      }
      return a;
    }),
  );
  panel.append(heading, cards);
  document.body.append(panel);

  const renderText = () => {
    for (const [el, key] of descriptions) el.textContent = tk(key);
  };
  renderText();
  onLangChange(renderText);

  // バーのすぐ下に開く（スマホでバーが折り返すと高さが変わるので、開くときと画面の大きさが変わったときに合わせる）。
  // 高さは画面の下までに収め、入りきらないときだけ縦にスクロールする
  const place = () => {
    const top = (button.closest(".bar") ?? button).getBoundingClientRect().bottom + 4;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${window.innerHeight - top - 12}px`;
  };
  window.addEventListener("resize", () => {
    if (!panel.hidden) place();
  });
  const setOpen = (open: boolean) => {
    if (open) {
      // ほかのまとまりのパネルは閉じる
      for (const other of document.querySelectorAll<HTMLElement>(".nav-panel:not([hidden])")) {
        if (other !== panel) other.dispatchEvent(new Event("nav-close"));
      }
      place();
    }
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  panel.addEventListener("nav-close", () => setOpen(false));
  button.addEventListener("click", () => setOpen(panel.hidden));
  // 閉じるためのクリックは、キャンバスに届けない（演奏が始まったり、音が加わったりしないように）
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (panel.hidden || panel.contains(e.target as Node) || button.contains(e.target as Node)) return;
      setOpen(false);
      if (e.target instanceof HTMLCanvasElement) e.stopPropagation();
    },
    true,
  );
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  return button;
}

// ページの <nav class="nav"> を組み立てる。言語の切り替えや説明より先に呼ぶ（それらがナビの中を見るので）
export function setupNav() {
  const nav = document.querySelector<HTMLElement>(".nav");
  if (!nav || nav.childElementCount > 0) return;
  const current = currentPageId();
  const home = document.createElement("a");
  home.href = "./";
  home.textContent = "sound-sketch";
  nav.append(home);
  for (const item of NAV) nav.append(isGroup(item) ? setupGroup(item, current) : link(item, current));
  for (const page of HIDDEN) if (page.id === current) nav.append(link(page, current));
  syncNavQuery();
}

// ナビのリンクに今のクエリ (?scale=…&root=…) を付け、ページを移っても設定を引き継ぐ
export function syncNavQuery() {
  for (const a of document.querySelectorAll<HTMLAnchorElement>(".nav a, .nav-panel a")) {
    const url = new URL(a.href);
    url.search = location.search;
    a.href = url.toString();
  }
}
