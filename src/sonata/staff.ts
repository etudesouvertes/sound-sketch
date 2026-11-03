import type { Pitch } from "../scales";

// 背景の大譜表。画面は音高の帯で縦に等分しているので、五線はその帯の上の、線の音の高さの位置に引く
// （7 音の音階ならほぼ等間隔、半音階や 5 音の音階では、線の間隔が少し揃わない）。
// 鳴った音の印は自分の音高の帯に描かれるので、線の音（ミ・ソ・シ・レ・ファ など）はちょうど線の上に乗る。
// 幹音が音階になく、その ♯ か ♭ の音があるときは、調号を付けて、線もその音の帯に引く（ロ短調ならファの線はファ♯の帯）

const TREBLE = [64, 67, 71, 74, 77]; // E4 G4 B4 D5 F5（下から）
const BASS = [43, 47, 50, 53, 57]; // G2 B2 D3 F3 A3
const STAFF_LEFT = 44;
const INK = "rgba(255, 255, 255, 0.14)";

// 調号の並びと、ト音記号の五線での位置（下の線から数えた度数。ヘ音記号では 2 つ下がる）
const SHARPS = [
  { pc: 5, step: 8 }, // ファ
  { pc: 0, step: 5 }, // ド
  { pc: 7, step: 9 }, // ソ
  { pc: 2, step: 6 }, // レ
  { pc: 9, step: 3 }, // ラ
  { pc: 4, step: 7 }, // ミ
  { pc: 11, step: 4 }, // シ
];
const FLATS = [
  { pc: 11, step: 4 }, // シ
  { pc: 4, step: 7 }, // ミ
  { pc: 9, step: 3 }, // ラ
  { pc: 2, step: 6 }, // レ
  { pc: 7, step: 2 }, // ソ
  { pc: 0, step: 5 }, // ド
  { pc: 5, step: 1 }, // ファ
];
const WHITE = [0, 2, 4, 5, 7, 9, 11];

// ♭ の調として書くことの多い主音（ヘ・変ロ・変ホ・変イ）では ♭ を、ほかは ♯ を先に探す
const FLAT_ROOTS = ["F", "A#", "D#", "G#"];

const midiOf = (freq: number) => 69 + 12 * Math.log2(freq / 440);

// MIDI の音高（小数でもよい）の y 座標。見えている音高の外は、端の 2 音の間隔で延ばす（画面の外になることもある）
function yOfMidi(midi: number, pitches: Pitch[], height: number): number {
  const midis = pitches.map((p) => midiOf(p.freq));
  const band = height / pitches.length;
  let i = 0;
  while (i < midis.length - 2 && midi > midis[i + 1]) i++;
  const position = i + (midi - midis[i]) / (midis[i + 1] - midis[i]);
  return height - (position + 0.5) * band;
}

// 大譜表の形。accidental は幹音に付ける調号、lineY は線の音（幹音）の y 座標で、
// 調号を付けた音が見えていればその帯、なければ音の高さから割り出す
export function staffLayout(pitches: Pitch[], height: number) {
  const rounded = pitches.map((p) => Math.round(midiOf(p.freq)));
  const inScale = new Set(rounded.map((m) => ((m % 12) + 12) % 12));
  const root = pitches.find((p) => p.isRoot)?.label.replace(/[0-9↑↓-]/g, "") ?? "C";
  const flatsFirst = FLAT_ROOTS.includes(root);
  const band = height / pitches.length;

  // 幹音（音名の pc）に付ける変化。音階にあれば 0、なければ黒鍵の ♯（+1）か ♭（-1）、どちらもなければ 0
  const accidental = (pc: number): number => {
    if (inScale.has(pc)) return 0;
    const sharp = WHITE.includes((pc + 1) % 12) ? null : 1;
    const flat = WHITE.includes((pc + 11) % 12) ? null : -1;
    for (const a of flatsFirst ? [flat, sharp] : [sharp, flat]) if (a !== null && inScale.has((pc + a + 12) % 12)) return a;
    return 0;
  };
  const lineY = (natural: number) => {
    const midi = natural + accidental(natural % 12);
    const i = rounded.indexOf(midi);
    return i >= 0 ? height - (i + 0.5) * band : yOfMidi(midi, pitches, height);
  };
  return { accidental, lineY, space: (lineY(TREBLE[0]) - lineY(TREBLE[4])) / 4 };
}
export type StaffLayout = ReturnType<typeof staffLayout>;

// 加線の音。ト音記号の五線の上、2 つの五線のあいだ（中央のド）、ヘ音記号の五線の下
const LEDGERS_ABOVE = [81, 84, 88, 91, 95, 98];
const LEDGER_MIDDLE = 60;
const LEDGERS_BELOW = [40, 36, 33, 29];

// y の高さの音符に要る加線の y 座標（五線から音符までの線と、音符が乗る線）
export function ledgersFor(layout: StaffLayout, y: number): number[] {
  const near = layout.space * 0.3;
  const top = layout.lineY(TREBLE[4]);
  const bottom = layout.lineY(BASS[0]);
  const middle = layout.lineY(LEDGER_MIDDLE);
  if (y < top - near) return LEDGERS_ABOVE.map(layout.lineY).filter((l) => l >= y - near);
  if (y > bottom + near) return LEDGERS_BELOW.map(layout.lineY).filter((l) => l <= y + near);
  return Math.abs(y - middle) < near ? [middle] : [];
}

// 音符を置き始められる x 座標（音部記号と調号の右）。最後に描いた大譜表で決まる
let left = STAFF_LEFT;
export const musicLeft = () => left;

export function drawStaff(g: CanvasRenderingContext2D, width: number, height: number, pitches: Pitch[]) {
  left = STAFF_LEFT;
  if (pitches.length < 2) return;
  const { accidental, lineY } = staffLayout(pitches, height);

  const staff = (lines: number[], glyph: string, anchor: number, scale: number, shift: number, offset: number) => {
    const ys = lines.map(lineY);
    if (ys[0] < 0 || ys[4] > height) return;
    g.lineWidth = 1;
    g.strokeStyle = "rgba(255, 255, 255, 0.13)";
    for (const y of ys) {
      if (y < 0 || y > height) continue;
      g.beginPath();
      g.moveTo(STAFF_LEFT, y);
      g.lineTo(width, y);
      g.stroke();
    }
    // 下の線から数えた度数（線と間）の y 座標。五線の外は、端の線の間隔で延ばす
    const stepY = (step: number) => {
      const at = Math.min(Math.max(Math.floor(step / 2), 0), 3);
      return ys[at] + ((ys[at + 1] - ys[at]) * (step / 2 - at));
    };
    const space = (ys[0] - ys[4]) / 4;

    // 音部記号は、ト音記号をソの線、ヘ音記号をファの線に合わせる。大きさは五線の高さから決める
    g.fillStyle = INK;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    const size = space * 4 * scale;
    g.font = `${size}px "Noto Music", "Segoe UI Symbol", "Apple Symbols", serif`;
    g.fillText(glyph, STAFF_LEFT + 2, lineY(anchor) + size * shift);
    let x = STAFF_LEFT + 2 + g.measureText(glyph).width;

    // 調号
    g.font = `${space * 2.4}px "Segoe UI Symbol", "Apple Symbols", "Noto Music", serif`;
    g.textBaseline = "middle";
    for (const { pc, step } of SHARPS) {
      if (accidental(pc) !== 1) continue;
      g.fillText("♯", x, stepY(step - offset) + space * 0.18);
      x += space * 0.9;
    }
    for (const { pc, step } of FLATS) {
      if (accidental(pc) !== -1) continue;
      g.fillText("♭", x, stepY(step - offset) - space * 0.27);
      x += space * 0.8;
    }
    g.textBaseline = "alphabetic";
    left = Math.max(left, x + space * 0.4);
  };
  staff(TREBLE, "\u{1D11E}", 67, 1.0, 0.13, 0);
  staff(BASS, "\u{1D122}", 53, 0.8, 0.42, 2);
}
