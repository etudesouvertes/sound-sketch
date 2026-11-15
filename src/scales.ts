import { syncNavQuery } from "./nav";
import { type L, onLangChange, t } from "./i18n";

// Ripples / Phase で共有するスケール定義と、選択 UI・音高ガイドの描画。
// steps は主音からの半音数。小数は四分音や平均律から外れた音（ガムランの近似など）。

export type Scale = { id: string; name: L; group: string; steps: number[] };

// 系統（地域や楽器）の見出し。group は日本語のまま識別子として使う
const GROUP_NAMES: Record<string, L> = {
  日本: { ja: "日本", en: "Japan" },
  中国: { ja: "中国", en: "China" },
  中近東: { ja: "中近東", en: "Middle East" },
  インド: { ja: "インド", en: "India" },
  バリ島: { ja: "バリ島", en: "Bali" },
  西洋: { ja: "西洋", en: "Western" },
  ハンドパン: { ja: "ハンドパン", en: "Handpan" },
};
export type Pitch = { freq: number; label: string; isRoot: boolean };

export const SCALES: Scale[] = [
  { group: "日本", id: "miyako", name: { ja: "都節音階（陰音階）", en: "Miyako-bushi (In scale)" }, steps: [0, 1, 5, 7, 8] },
  { group: "日本", id: "minyo", name: { ja: "民謡音階", en: "Min'yō" }, steps: [0, 3, 5, 7, 10] },
  { group: "日本", id: "ritsu", name: { ja: "律音階", en: "Ritsu" }, steps: [0, 2, 5, 7, 9] },
  { group: "日本", id: "ryukyu", name: { ja: "琉球音階", en: "Ryūkyū (Okinawan)" }, steps: [0, 4, 5, 7, 11] },
  { group: "日本", id: "iwato", name: { ja: "岩戸音階", en: "Iwato" }, steps: [0, 1, 5, 6, 10] },
  { group: "中国", id: "gong", name: { ja: "宮調", en: "Gong mode" }, steps: [0, 2, 4, 7, 9] },
  { group: "中国", id: "shang", name: { ja: "商調", en: "Shang mode" }, steps: [0, 2, 5, 7, 10] },
  { group: "中国", id: "jue", name: { ja: "角調", en: "Jue mode" }, steps: [0, 3, 5, 8, 10] },
  { group: "中国", id: "zhi", name: { ja: "徴調", en: "Zhi mode" }, steps: [0, 2, 5, 7, 9] },
  { group: "中国", id: "yu", name: { ja: "羽調", en: "Yu mode" }, steps: [0, 3, 5, 7, 10] },
  { group: "中近東", id: "hijaz", name: { ja: "ヒジャーズ", en: "Hijaz" }, steps: [0, 1, 4, 5, 7, 8, 10] },
  { group: "中近東", id: "hijaz-kar", name: { ja: "ヒジャーズ・カール", en: "Hijaz Kar" }, steps: [0, 1, 4, 5, 7, 8, 11] },
  { group: "中近東", id: "rast", name: { ja: "ラスト（四分音）", en: "Rast (quarter tones)" }, steps: [0, 2, 3.5, 5, 7, 9, 10.5] },
  { group: "中近東", id: "bayati", name: { ja: "バヤーティ（四分音）", en: "Bayati (quarter tones)" }, steps: [0, 1.5, 3, 5, 7, 8, 10] },
  { group: "中近東", id: "saba", name: { ja: "サバー（四分音）", en: "Saba (quarter tones)" }, steps: [0, 1.5, 3, 4, 7, 8, 10] },
  { group: "インド", id: "yaman", name: { ja: "ヤマン", en: "Yaman" }, steps: [0, 2, 4, 6, 7, 9, 11] },
  { group: "インド", id: "bhairav", name: { ja: "バイラヴ", en: "Bhairav" }, steps: [0, 1, 4, 5, 7, 8, 11] },
  { group: "インド", id: "bhairavi", name: { ja: "バイラヴィ", en: "Bhairavi" }, steps: [0, 1, 3, 5, 7, 8, 10] },
  { group: "インド", id: "todi", name: { ja: "トーディ", en: "Todi" }, steps: [0, 1, 3, 6, 7, 8, 11] },
  { group: "インド", id: "marwa", name: { ja: "マルワ", en: "Marwa" }, steps: [0, 1, 4, 6, 9, 11] },
  { group: "バリ島", id: "pelog-selisir", name: { ja: "ペロッグ・スリシール", en: "Pelog Selisir" }, steps: [0, 1, 3, 7, 8] },
  { group: "バリ島", id: "pelog", name: { ja: "ペロッグ（7音・ガムラン調律の近似）", en: "Pelog (7-tone, gamelan approx.)" }, steps: [0, 1.2, 2.7, 5.4, 6.7, 7.85, 9.5] },
  { group: "バリ島", id: "slendro", name: { ja: "スレンドロ（オクターブ5等分）", en: "Slendro (octave in 5 equal steps)" }, steps: [0, 2.4, 4.8, 7.2, 9.6] },
  { group: "西洋", id: "major-pentatonic", name: { ja: "メジャーペンタトニック", en: "Major pentatonic" }, steps: [0, 2, 4, 7, 9] },
  { group: "西洋", id: "minor-pentatonic", name: { ja: "マイナーペンタトニック", en: "Minor pentatonic" }, steps: [0, 3, 5, 7, 10] },
  { group: "西洋", id: "blues", name: { ja: "ブルース", en: "Blues" }, steps: [0, 3, 5, 6, 7, 10] },
  { group: "西洋", id: "lydian", name: { ja: "リディアン", en: "Lydian" }, steps: [0, 2, 4, 6, 7, 9, 11] },
  { group: "西洋", id: "mixolydian", name: { ja: "ミクソリディアン", en: "Mixolydian" }, steps: [0, 2, 4, 5, 7, 9, 10] },
  { group: "西洋", id: "dorian", name: { ja: "ドリアン", en: "Dorian" }, steps: [0, 2, 3, 5, 7, 9, 10] },
  { group: "西洋", id: "aeolian", name: { ja: "エオリアン（自然短音階）", en: "Aeolian (natural minor)" }, steps: [0, 2, 3, 5, 7, 8, 10] },
  { group: "西洋", id: "phrygian", name: { ja: "フリジアン", en: "Phrygian" }, steps: [0, 1, 3, 5, 7, 8, 10] },
  { group: "西洋", id: "whole-tone", name: { ja: "全音音階", en: "Whole tone" }, steps: [0, 2, 4, 6, 8, 10] },
  // ハンドパンの名前はマカームから借りていても、中身は平均律の西洋の旋法に近い（Kurd はエオリアン）。
  // 実際の楽器はドゥムの上に 5 度下の音が来るなど、オクターブごとに並びが違うが、ここでは 1 オクターブの型で近似する
  { group: "ハンドパン", id: "kurd", name: { ja: "クルド", en: "Kurd" }, steps: [0, 2, 3, 5, 7, 8, 10] },
  { group: "ハンドパン", id: "celtic-minor", name: { ja: "ケルティック・マイナー", en: "Celtic Minor" }, steps: [0, 2, 3, 5, 7, 10] },
  { group: "ハンドパン", id: "integral", name: { ja: "インテグラル", en: "Integral" }, steps: [0, 2, 3, 7, 8, 10] },
  { group: "ハンドパン", id: "handpan-hijaz", name: { ja: "ヒジャーズ（ハンドパン）", en: "Hijaz (handpan)" }, steps: [0, 2, 3, 5, 7, 8, 11] },
  // C# / G# C C# Eb F G G# C の楽器から。6 度のないリディアン。Equinox はメーカーによって構成音が違うことがある
  { group: "ハンドパン", id: "deep-equinox", name: { ja: "ディープ・イクイノックス", en: "Deep Equinox" }, steps: [0, 2, 4, 6, 7, 11] },
];

export const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 音域を動かせるよう 7 オクターブ分を持ち、画面にはそのうち 3 オクターブ分を割り当てる
const OCTAVES = [1, 2, 3, 4, 5, 6, 7];
const VISIBLE_OCTAVES = 3;
const MAX_REGISTER = 2; // 窓をずらせる最大オクターブ数

// 画面に割り当てる 3 オクターブ分を切り出す。register（オクターブ単位、-2〜2）で窓をずらす。
// 音階の度数単位でずらすので、音域が動いてもスケールから外れない
export function visiblePitches(all: Pitch[], register: number): Pitch[] {
  const perOctave = all.length / OCTAVES.length;
  const clamped = Math.min(Math.max(register, -MAX_REGISTER), MAX_REGISTER);
  const start = MAX_REGISTER * perOctave + Math.round(clamped * perOctave);
  return all.slice(start, start + perOctave * VISIBLE_OCTAVES);
}

// 低い順に並んだ音高の一覧。音名は最も近い平均律の音で、ずれていれば ↑↓ を付ける
export function pitchesOf(scale: Scale, root: string): Pitch[] {
  const rootIndex = ROOTS.indexOf(root);
  return OCTAVES.flatMap((oct) =>
    scale.steps.map((step) => {
      const midi = 12 * (oct + 1) + rootIndex + step;
      const nearest = Math.round(midi);
      const diff = midi - nearest;
      const mark = Math.abs(diff) < 0.05 ? "" : diff > 0 ? "↑" : "↓";
      return {
        freq: 440 * 2 ** ((midi - 69) / 12),
        label: `${ROOTS[nearest % 12]}${Math.floor(nearest / 12) - 1}${mark}`,
        isRoot: step === 0,
      };
    }),
  );
}

// 画面を音高の数で縦に等分し、上ほど高い音にする
export function pitchIndexAt(y: number, height: number, count: number): number {
  return Math.floor((1 - y / height) * count);
}

export function pitchAt(pitches: Pitch[], index: number): Pitch {
  return pitches[Math.min(Math.max(index, 0), pitches.length - 1)];
}

// 各音高の帯の中央に薄い横線と音名を描く。主音の線だけ少し明るくする
export function drawPitchGuides(g: CanvasRenderingContext2D, width: number, height: number, pitches: Pitch[]) {
  const band = height / pitches.length;
  g.font = "10px system-ui, sans-serif";
  g.textAlign = "left";
  g.lineWidth = 1;
  pitches.forEach((p, i) => {
    const y = height - (i + 0.5) * band;
    g.strokeStyle = p.isRoot ? "rgba(108, 196, 255, 0.10)" : "rgba(255, 255, 255, 0.035)";
    g.beginPath();
    g.moveTo(44, y);
    g.lineTo(width, y);
    g.stroke();
    g.fillStyle = p.isRoot ? "rgba(108, 196, 255, 0.45)" : "rgba(255, 255, 255, 0.22)";
    g.fillText(p.label, 10, y + 3);
  });
}

// 系統・スケール・主音のプルダウンを用意し、選択を URL (?scale=…&root=…) と同期する。
// transposeRoot はプログラムから変えるとき（転調）に使う。
export function setupScalePicker(
  groupEl: HTMLSelectElement,
  scaleEl: HTMLSelectElement,
  rootEl: HTMLSelectElement,
  defaults: { scale: string; root: string },
  onChange: (pitches: Pitch[]) => void,
): {
  pitches: Pitch[];
  transposeRoot: (semitones: number) => void;
  root: () => string;
  refresh: () => void;
} {
  // 系統のプルダウンで系統を選び、スケールのプルダウンにはその系統のスケールだけを出す。
  // 全部を 1 本に並べると縦に長くなりすぎるため。URL にはスケールだけを書き、系統はスケールから引く
  const groups = [...new Set(SCALES.map((s) => s.group))];
  for (const g of groups) groupEl.append(new Option("", g));
  for (const r of ROOTS) rootEl.append(new Option(r, r));

  const fillScales = (group: string) => {
    scaleEl.replaceChildren(
      ...SCALES.filter((s) => s.group === group).map((s) => new Option(t(s.name), s.id)),
    );
  };
  const groupOf = (id: string) => SCALES.find((s) => s.id === id)!.group;
  const selectScale = (id: string) => {
    groupEl.value = groupOf(id);
    fillScales(groupEl.value);
    scaleEl.value = id;
  };
  const renderNames = () => {
    for (const option of groupEl.options) option.text = t(GROUP_NAMES[option.value]);
    for (const option of scaleEl.options) option.text = t(SCALES.find((s) => s.id === option.value)!.name);
  };

  const params = new URLSearchParams(location.search);
  const scaleParam = params.get("scale");
  const rootParam = params.get("root");
  const known = (id: string | null) => SCALES.some((s) => s.id === id);
  selectScale(known(scaleParam) ? scaleParam! : defaults.scale);
  rootEl.value = rootParam && ROOTS.includes(rootParam) ? rootParam : defaults.root;
  renderNames();
  onLangChange(renderNames);

  const current = () => pitchesOf(SCALES.find((s) => s.id === scaleEl.value)!, rootEl.value);
  // 初期値も URL に書いておき、別ページへ移ったときにそのページの初期値で上書きされないようにする
  const writeUrl = () => {
    const url = new URL(location.href);
    url.searchParams.set("scale", scaleEl.value);
    url.searchParams.set("root", rootEl.value);
    history.replaceState(null, "", url);
    syncNavQuery();
  };
  const update = () => {
    writeUrl();
    onChange(current());
  };
  // 系統ごとに最後に選んだスケールを覚えておき、系統を戻したときはそれに戻す。初めての系統なら先頭のスケール
  const lastInGroup = new Map<string, string>([[groupEl.value, scaleEl.value]]);
  groupEl.addEventListener("change", () => {
    fillScales(groupEl.value);
    const last = lastInGroup.get(groupEl.value);
    if (last) scaleEl.value = last;
    lastInGroup.set(groupEl.value, scaleEl.value);
    update();
  });
  scaleEl.addEventListener("change", () => {
    lastInGroup.set(groupEl.value, scaleEl.value);
    update();
  });
  rootEl.addEventListener("change", update);
  writeUrl();
  const transposeRoot = (semitones: number) => {
    rootEl.value = ROOTS[(ROOTS.indexOf(rootEl.value) + semitones + 12) % 12];
    update();
  };
  return { pitches: current(), transposeRoot, root: () => rootEl.value, refresh: update };
}
