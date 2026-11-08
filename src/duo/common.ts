import { t, type L } from "../i18n";
import { flowView, type FlowMark, type Layout, MARGIN_LEFT, type MovementContext, musicFrom, type Queue } from "../sonata/movement";
import { clefTop } from "../sonata/staff";

// Duo の組で共通の部品: 2 台のピアノの色分け、音の鳴らし方と印、凡例

export const FIRST = 0;
export const SECOND = 1;
export const BOTH = 2;
export type Owner = typeof FIRST | typeof SECOND | typeof BOTH;
export const HUES = [28, 200]; // ピアノ I は橙、ピアノ II は青

// --- 画面: 鳴った音が右端から左へ流れる（台ごとに色を分ける）。上には、どちらのピアノが何色かと、楽章ごとの仕組みを出す ---

export const WINDOW = 10;
type DuoMark = FlowMark & { piano: number };

export const markView = (ctx: MovementContext) =>
  flowView<DuoMark>(ctx, WINDOW, (g, m, _x, _y, ringing, fade, _span, note) => {
    g.fillStyle = `hsla(${HUES[m.piano]}, 65%, ${58 + 20 * ringing}%, ${(0.25 + 0.6 * ringing) * fade})`;
    note(2 * (2 + 5 * m.velocity + 2 * ringing));
  });
export type View = ReturnType<typeof markView>;

// index の音を、piano の台で鳴らし、印を付ける（画面の外の音は、オクターブを指定して鳴らす）。cents は音階の外の音にずらすとき
export function play(h: Layout, queue: Queue, view: View, piano: number, index: number, time: number, velocity: number, seconds: number, cents = 0) {
  queue.add({ time, ...h.place(index), velocity, seconds, piano, cents, onPlay: view.add({ time, index, piano, seconds, velocity }) });
}

// base の音から semis 半音離れた音を、近い音階の音と、そこからのずれ（セント）で表す（全音音階のように、音階の外の音を弾くため）
export function chromaticAt(h: Layout, base: number, semis: number): { index: number; cents: number } {
  const freqOf = (i: number) => {
    const { index, octave } = h.place(i);
    return h.pitches[index].freq * 2 ** octave;
  };
  const target = freqOf(base) * 2 ** (semis / 12);
  let best = base;
  for (let i = base - 10; i <= base + 10; i++) if (Math.abs(Math.log2(freqOf(i) / target)) < Math.abs(Math.log2(freqOf(best) / target))) best = i;
  return { index: best, cents: Math.round(1200 * Math.log2(target / freqOf(best))) };
}

export const LEGEND_Y = 62;
export const INFO_Y = 74;
// 上端の案内（凡例と楽章ごとの仕組み）の左端。画面が低くて五線が案内の高さまで上がってくるときは、
// 音部記号と調号に重ならないよう、その右から書く
// bottom は案内の下端（組ごとに行の数が違う）。楽章は、音を描く範囲の上端まで下げた座標で描くので、その分を足して比べる
export function guideLeft(g: CanvasRenderingContext2D, bottom: number): number {
  const m = g.getTransform();
  const shift = m.f / (m.d || 1);
  return shift + bottom > clefTop() ? musicFrom(16) : MARGIN_LEFT;
}
const NAMES: L[] = [
  { ja: "ピアノ I（左）", en: "Piano I (left)" },
  { ja: "ピアノ II（右）", en: "Piano II (right)" },
];
export const ownerColor = (owner: Owner, alpha: number) =>
  owner === BOTH ? `rgba(255, 255, 255, ${alpha})` : `hsla(${HUES[owner]}, 65%, 62%, ${alpha})`;

export function legend(g: CanvasRenderingContext2D, bottom: number) {
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "left";
  let x = guideLeft(g, bottom);
  NAMES.forEach((name, i) => {
    g.fillStyle = ownerColor(i as Owner, 0.9);
    g.beginPath();
    g.arc(x + 4, LEGEND_Y - 4, 4, 0, Math.PI * 2);
    g.fill();
    const text = t(name);
    g.fillStyle = "rgba(255, 255, 255, 0.55)";
    g.fillText(text, x + 12, LEGEND_Y);
    x += 12 + g.measureText(text).width + 18;
  });
}

// 度数（7 で 1 オクターブ上）を、画面の一番下の主音から数えた音の位置に直す
export const fromLow = (h: Layout, degree: number) => h.lowRoot + h.degree(degree);

// 音の名前（オクターブの数字なし）。♯ の付く音は、同じ幹音（A♯ なら A）が音階にあるときは、次の幹音の ♭ で書く（F 長音階の B♭）
export function noteName(h: Layout, index: number): string {
  const nameOf = (label: string) => label.replace(/-?\d.*$/, "");
  const label = nameOf(h.pitches[h.place(index).index].label);
  if (!label.includes("#")) return label;
  const letters = "CDEFGAB";
  const natural = label[0];
  if (!h.pitches.some((p) => nameOf(p.label) === natural)) return label.replace("#", "♯");
  return `${letters[(letters.indexOf(natural) + 1) % 7]}♭`;
}
