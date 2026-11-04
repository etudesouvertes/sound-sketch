import "./i18n.css";
import { STRINGS } from "./i18n-strings";

// 表示言語（日本語 / 英語）の切り替え。ページを再読み込みせずにその場で表示を変えるので、演奏はそのまま続く。
// HTML の文言は data-i18n（本文）・data-i18n-aria（aria-label）に辞書のキーを書き、
// JS で組み立てる文言は onLangChange で切り替え時に作り直す。選んだ言語はブラウザに保存する

export type Lang = "ja" | "en";
export type L = Record<Lang, string>;

const STORAGE_KEY = "sound-sketch:lang";
const listeners: (() => void)[] = [];

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ja" || saved === "en") return saved;
  } catch {
    // 保存を読めない環境では、ブラウザの言語設定で決める
  }
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

let lang: Lang = loadLang();

export const getLang = () => lang;

export function t(entry: L): string {
  return entry[lang];
}

// 辞書のキーから引く。改行は <br> にする
export function tk(key: string): string {
  const entry = STRINGS[key];
  if (!entry) throw new Error(`unknown i18n key: ${key}`);
  return entry[lang];
}

export function onLangChange(callback: () => void) {
  listeners.push(callback);
}

function applyStatic() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const lines = tk(el.dataset.i18n!).split("\n");
    // 画面の中央の案内（.hint）は、行ごとに段落のように分ける。行ごとに text-wrap: balance が効き、1 文字だけ次の行に回らない
    if (el.classList.contains("hint")) {
      el.replaceChildren(...lines.map((line) => Object.assign(document.createElement("span"), { textContent: line, style: "display: block" })));
      continue;
    }
    el.replaceChildren(...lines.flatMap((line, i) => (i === 0 ? [line] : [document.createElement("br"), line])));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-aria]")) {
    el.setAttribute("aria-label", tk(el.dataset.i18nAria!));
  }
}

export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 保存できない環境では、次に開いたときにブラウザの言語設定に戻るだけ
  }
  applyStatic();
  for (const callback of listeners) callback();
}

// 「JP / EN」ボタンを置き、HTML の文言を今の言語にする。ほかの setup より先に呼ぶ
export function setupI18n() {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "lang-toggle";
  const ja = document.createElement("span");
  ja.textContent = "JP";
  const en = document.createElement("span");
  en.textContent = "EN";
  toggle.append(ja, " / ", en);
  toggle.setAttribute("aria-label", "Language / 言語");

  const render = () => {
    ja.classList.toggle("current", lang === "ja");
    en.classList.toggle("current", lang === "en");
  };
  toggle.addEventListener("click", () => setLang(lang === "ja" ? "en" : "ja"));
  onLangChange(render);

  // キャンバスのページではバーの右側、Keyboard ではナビの並びに置く
  (document.querySelector(".bar-actions") ?? document.querySelector(".nav")!).append(toggle);
  applyStatic();
  render();
}
