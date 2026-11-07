import { syncNavQuery } from "./nav";

// 音域と密度の 5 段階スライダー。3 が標準で、選択は URL (?register=…&density=…) に残してページ間で引き継ぐ

export const DEFAULT_LEVEL = 3;

// 1 段階ごとに半オクターブずらす（1 = 1 オクターブ低い、5 = 1 オクターブ高い）
export const registerOffset = (level: number) => (level - DEFAULT_LEVEL) * 0.5;

// 自動で置かれる頻度の倍率（1 ≒ 0.35 倍、3 = 1 倍、5 ≒ 2.8 倍）
export const densityLevelFactor = (level: number) => 2 ** ((level - DEFAULT_LEVEL) * 0.75);

export function setupLevel(
  inputEl: HTMLInputElement,
  outputEl: HTMLOutputElement,
  param: string,
  onChange: (level: number) => void,
  initial = DEFAULT_LEVEL, // URL に値がないときの初めの値
): number {
  const fromUrl = Number(new URLSearchParams(location.search).get(param));
  inputEl.value = String(Number.isInteger(fromUrl) && fromUrl >= 1 && fromUrl <= 5 ? fromUrl : initial);
  outputEl.value = inputEl.value;

  const writeUrl = () => {
    const url = new URL(location.href);
    url.searchParams.set(param, inputEl.value);
    history.replaceState(null, "", url);
    syncNavQuery();
  };
  inputEl.addEventListener("input", () => {
    outputEl.value = inputEl.value;
    writeUrl();
    onChange(Number(inputEl.value));
  });
  writeUrl();
  return Number(inputEl.value);
}
