// 「みんなで鳴らす」の楽譜。ジョン・ケージ『Imaginary Landscape No. 4』のように、いつダイヤルをどこへ回し、
// 音量をどうするかを決める。楽譜は、共通の種（URL の score）と今の時刻だけから決まるので、
// 同じ URL を開いた端末どうしは、通信しなくても同じ時刻に同じ動きをする。途中から開いても、その時刻の箇所から入れる。
// 時間を BAR 秒ごとの小節に分け、小節ごとに「ダイヤルを回し始めるか」「音量を変えるか」を種と小節の番号から決める。
// 回すときは、前の行き先から次の行き先へ、次に回し始める小節までに着く速さで動く（どの時刻の針の位置も、前後の小節だけで決まる）

export const BAR = 6; // 1 小節 (秒)
const FORCE_EVERY = 16; // この小節ごとに、必ず回し始める・音量を変える（探す範囲を限るため）
const MOVE_CHANCE = 0.35; // 小節ごとに、ダイヤルを回し始める確率
const VOLUME_CHANCE = 0.2; // 小節ごとに、音量を変える確率
const SILENCE_CHANCE = 0.2; // 音量を変えるとき、黙る確率
const VOLUMES = [0.35, 0.6, 0.85, 1];
const VOLUME_RAMP = 3; // 音量を移す時間 (秒)
const SPEED = [0.01, 0.05]; // 回す速さ（ダイヤル幅/秒）
const SWEEP_CHANCE = 0.12; // 速く回す（局をいくつも通り過ぎる）確率
const SWEEP_SPEED = 0.25;

// --- 種から決まる乱数 ---

// 文字列から 32 ビットの数
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// いくつかの整数から、0〜1 の数を 1 つ決める（同じ数を渡せば、どの端末でも同じ値）
export function hashRandom(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    // 小節の番号は 32 ビットに収まらないので、上の桁も混ぜる
    h = Math.imul(h ^ Math.floor(v / 4294967296), 0x27d4eb2d);
  }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const seedNumber = (seed: string) => hashString(seed);

// 種から決まる乱数の列（局の位置を並べるのに使う）
export function seededRandom(...values: number[]): () => number {
  let n = 0;
  return () => hashRandom(...values, n++);
}

// 新しい楽譜の種（URL に入れる短い文字列）
export function newSeed(): string {
  return Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
}

// --- 楽譜 ---

// 楽譜が回し先に選ぶもの（ダイヤルの局の位置から決める）
export type ScoreSlot = { pos: number; kind: "station" | "carrier" };
// 局の位置に対して、行き先を決めるのに使う幅
export type ScoreWidths = { tune: number; whistle: number; whistleSteps: number };

export type ScoreState = {
  pos: number; // 針の位置
  target: number; // 今向かっている（とどまっている）位置
  volume: number; // 音量 (0〜1)
};

const moves = (seed: number, part: number, bar: number) =>
  bar % FORCE_EVERY === 0 || hashRandom(seed, part, bar, 1) < MOVE_CHANCE;
const volumeChanges = (seed: number, part: number, bar: number) =>
  bar % FORCE_EVERY === FORCE_EVERY / 2 || hashRandom(seed, part, bar, 10) < VOLUME_CHANCE;

// bar 以前（bar を含む）で、最後に起きた小節
function lastBar(bar: number, happens: (b: number) => boolean): number {
  for (let b = bar; b > bar - FORCE_EVERY; b--) if (happens(b)) return b;
  return bar - FORCE_EVERY;
}
// bar より後で、最初に起きる小節
function nextBar(bar: number, happens: (b: number) => boolean): number {
  for (let b = bar + 1; b <= bar + FORCE_EVERY; b++) if (happens(b)) return b;
  return bar + FORCE_EVERY;
}

// その小節で回し始めるときの行き先: 局に合わせる、局の近くでうなりを 1 つの音に止める、どこでもないところで雑音を聴く
function targetAt(seed: number, part: number, bar: number, slots: ScoreSlot[], w: ScoreWidths): number {
  const r = (k: number) => hashRandom(seed, part, bar, k);
  const stations = slots.filter((s) => s.kind === "station");
  const roll = r(2);
  let target: number;
  if (roll < 0.55 && stations.length > 0) {
    const s = stations[Math.floor(r(3) * stations.length)];
    target = s.pos + (r(4) - 0.5) * 0.4 * w.tune;
  } else if (roll < 0.85 && slots.length > 0) {
    const s = slots[Math.floor(r(3) * slots.length)];
    const step = 1 + Math.floor(r(5) * (w.whistleSteps - 2));
    target = s.pos + (r(6) < 0.5 ? -1 : 1) * ((step + 0.5) / w.whistleSteps) * w.whistle;
  } else target = r(7);
  return Math.min(1, Math.max(0, target));
}

function volumeAt(seed: number, part: number, bar: number): number {
  const r = (k: number) => hashRandom(seed, part, bar, k);
  return r(11) < SILENCE_CHANCE ? 0 : VOLUMES[Math.floor(r(12) * VOLUMES.length)];
}

// 時刻 time（秒）での、パート part の針の位置と音量
export function scoreState(seedText: string, part: number, slots: ScoreSlot[], widths: ScoreWidths, time: number): ScoreState {
  const seed = seedNumber(seedText);
  const bar = Math.floor(time / BAR);

  // 針: 前の行き先 (from) から、今の行き先 (to) へ。次に回し始める小節までに着く
  const moveBar = lastBar(bar, (b) => moves(seed, part, b));
  const fromBar = lastBar(moveBar - 1, (b) => moves(seed, part, b));
  const until = nextBar(moveBar, (b) => moves(seed, part, b));
  const from = targetAt(seed, part, fromBar, slots, widths);
  const to = targetAt(seed, part, moveBar, slots, widths);
  const distance = Math.abs(to - from);
  const sweep = hashRandom(seed, part, moveBar, 8) < SWEEP_CHANCE;
  const base = sweep ? SWEEP_SPEED : SPEED[0] + hashRandom(seed, part, moveBar, 9) * (SPEED[1] - SPEED[0]);
  const available = (until - moveBar) * BAR - 1; // 次に回し始める 1 秒前には着く
  const speed = Math.max(base, distance / Math.max(available, 1));
  const travelled = Math.min(distance, speed * (time - moveBar * BAR));
  const pos = from + Math.sign(to - from) * travelled;

  // 音量: 前の音量から、今の音量へ VOLUME_RAMP 秒で移す
  const volumeBar = lastBar(bar, (b) => volumeChanges(seed, part, b));
  const previousBar = lastBar(volumeBar - 1, (b) => volumeChanges(seed, part, b));
  const before = volumeAt(seed, part, previousBar);
  const after = volumeAt(seed, part, volumeBar);
  const progress = Math.min(1, (time - volumeBar * BAR) / VOLUME_RAMP);
  const volume = before + (after - before) * progress;

  return { pos, target: to, volume };
}

// --- 時計 ---

// 端末の時計のずれを、このサイトのサーバーの時刻（応答の Date ヘッダー）で直す。Date は秒までなので、ずれは 1 秒ほど残る
let clockOffset = 0; // ミリ秒

export async function syncClock(): Promise<void> {
  try {
    const sent = Date.now();
    const response = await fetch(location.href, { method: "HEAD", cache: "no-store" });
    const received = Date.now();
    const date = response.headers.get("date");
    if (!date) return;
    // Date は秒の切り捨てなので、平均して 0.5 秒足す。行き帰りの時間の半分を、届くまでの時間とみなす
    const server = Date.parse(date) + 500 + (received - sent) / 2;
    if (Number.isFinite(server)) clockOffset = server - received;
  } catch {
    // 合わせられないときは、端末の時計のまま
  }
}

export const scoreNow = () => (Date.now() + clockOffset) / 1000;
