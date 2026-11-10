import * as Tone from "tone";

// ページの動き（step: 音にかかわる処理）と、画面の描画（draw）を回す。
// 画面のループ（requestAnimationFrame）は、別のタブを開くなどして画面が隠れると止まる。
// 隠れているあいだは、音の時計（Tone.js のタイマー。裏に回っても止まらない）で step だけを進め、
// 自動で鳴らす・ダイヤルを回すなどが、見ていなくても続くようにする（描画は、見えているときだけ）

const HIDDEN_STEP = 0.05; // 隠れているあいだ、step を呼ぶ間隔 (秒)
const MAX_DT = 0.05; // 1 回に進める時間の上限 (秒)。間が空いたときに、一度に進みすぎないように
const MAX_HIDDEN_DT = 0.1; // 隠れているあいだは、タイマーが遅れがちなので少し長く

export function runLoop(step: (dt: number, nowMs: number) => void, draw: () => void) {
  let last = performance.now();
  const advance = (nowMs: number, maxDt: number) => {
    // 隠れていたあいだと見えているときで時刻の取り方が違うので、戻ることがある
    const dt = Math.min(Math.max(0, (nowMs - last) / 1000), maxDt);
    last = Math.max(last, nowMs);
    step(dt, nowMs);
  };
  const frame = (nowMs: number) => {
    advance(nowMs, MAX_DT);
    draw();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // 音が止まっている（始める前・一時停止中）あいだは、音の時計も止まっているので、これも呼ばれない
  Tone.getContext().setInterval(() => {
    if (document.hidden) advance(performance.now(), MAX_HIDDEN_DT);
  }, HIDDEN_STEP);
}
