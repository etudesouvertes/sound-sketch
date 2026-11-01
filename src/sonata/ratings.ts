// 楽章ごとの評価（良い・普通・ダメ）の記録。あとで傾向を調べられるよう、評価と一緒に、種・設定・聴いた状況と、
// 実際に鳴った音から計算した材料の特徴量を残す。記録はこのブラウザの中（localStorage）だけに置き、JSON や CSV で書き出す

export type Rating = "good" | "ok" | "bad";

type Note = { t: number; midi: number; velocity: number; seconds: number }; // t は楽章の始まりからの秒

// 1 つの楽章を聴いている間の情報。楽章を始めるたびに作り、次の楽章を始めるまで評価できる
export type Listening = {
  runId: string;
  seed: string;
  seedFixed: boolean;
  composer: string;
  movement: number;
  title: string;
  planned: number; // 楽章の目安の長さ（秒）
  startedAt: number; // 音の時計の時刻
  finishedAt: number | null;
  stoppedAt?: number; // 停止で途中で止めた時刻（聴いた長さはここまで。最後まで聴いたことにはしない）
  notes: Note[];
  clicks: number;
  previous: string | null; // 直前に聴いた楽章（"reich:0" の形）
  playIndex: number; // その日に何楽章目か
  rootPc: number; // 主音の音名（0 = C）
  settings: Record<string, string | number | boolean>;
  mood: Record<string, string | number> | null; // 天気（オフのときは null）
};

export type RatingRecord = {
  runId: string;
  ratedAt: string;
  rating: Rating;
  seed: string;
  seedFixed: boolean;
  composer: string;
  movement: number;
  title: string;
  planned: number;
  listened: number;
  finished: boolean;
  settings: Listening["settings"];
  mood: Listening["mood"];
  context: { hour: number; weekday: number; playIndex: number; previous: string | null; clicks: number };
  features: Record<string, number>;
};

const KEY = "sonata-ratings";
const PLAYS_KEY = "sonata-plays";

export const midiOf = (freq: number) => 12 * Math.log2(freq / 440) + 69;

export function loadRecords(): RatingRecord[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveRecords(records: RatingRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch (e) {
    console.warn(e);
  }
}

export function clearRecords() {
  saveRecords([]);
}

// その日に何楽章目かを数える（日付が変わると 1 から）
export function nextPlayIndex(): number {
  const today = new Date().toLocaleDateString("sv"); // YYYY-MM-DD
  let count = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYS_KEY) ?? "null");
    if (saved?.date === today) count = saved.count;
    localStorage.setItem(PLAYS_KEY, JSON.stringify({ date: today, count: count + 1 }));
  } catch {
    // 数えられなくても評価はできる
  }
  return count + 1;
}

// 評価を記録する。同じ楽章（runId）を評価し直したときは、前の評価を置き換える
export function rate(listening: Listening, rating: Rating, now: number): RatingRecord {
  const listened = (listening.finishedAt ?? listening.stoppedAt ?? now) - listening.startedAt;
  const date = new Date();
  const record: RatingRecord = {
    runId: listening.runId,
    ratedAt: date.toISOString(),
    rating,
    seed: listening.seed,
    seedFixed: listening.seedFixed,
    composer: listening.composer,
    movement: listening.movement,
    title: listening.title,
    planned: round(listening.planned),
    listened: round(listened),
    finished: listening.finishedAt !== null,
    settings: listening.settings,
    mood: listening.mood,
    context: { hour: date.getHours(), weekday: date.getDay(), playIndex: listening.playIndex, previous: listening.previous, clicks: listening.clicks },
    features: features(listening.notes.filter((n) => n.t <= listened), listening.rootPc),
  };
  saveRecords([...loadRecords().filter((r) => r.runId !== listening.runId), record]);
  return record;
}

const round = (x: number) => Math.round(x * 1000) / 1000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

// --- 材料の特徴量: どの楽章にも共通に、鳴った音だけから計算する ---

const SPLIT = 60; // 右手と左手の分け目（C4）
const CHORD = 0.01; // これより近い音は同時（和音）とみなす

export function features(notes: Note[], rootPc: number): Record<string, number> {
  if (notes.length === 0) return { notes: 0 };
  const sorted = [...notes].sort((a, b) => a.t - b.t);
  const span = Math.max(sorted.at(-1)!.t - sorted[0].t, 1);
  const pitches = sorted.map((n) => n.midi);
  const pc = (midi: number) => ((Math.round(midi) % 12) + 12) % 12;

  // 同時に鳴った音をまとめる
  const onsets: Note[][] = [];
  for (const n of sorted) {
    const last = onsets.at(-1);
    if (last && n.t - last[0].t < CHORD) last.push(n);
    else onsets.push([n]);
  }

  // 手ごとに、続けて鳴った音の音程（同時の音は、右手は一番高い音、左手は一番低い音を代表にする）
  const lines = [
    onsets.flatMap((o) => {
      const upper = o.filter((n) => n.midi >= SPLIT);
      return upper.length ? [Math.max(...upper.map((n) => n.midi))] : [];
    }),
    onsets.flatMap((o) => {
      const lower = o.filter((n) => n.midi < SPLIT);
      return lower.length ? [Math.min(...lower.map((n) => n.midi))] : [];
    }),
  ];
  const intervals = lines.flatMap((line) => line.slice(1).map((m, i) => m - line[i]));
  const moves = intervals.filter((i) => Math.abs(i) > 0.25);
  // 繰り返しの度合い: 3 つ続く音程の並び（4 音の音型）が、それより前にも出てきた割合
  let grams = 0;
  let repeats = 0;
  for (const line of lines) {
    const seen = new Set<string>();
    for (let i = 3; i < line.length; i++) {
      const key = [line[i - 2] - line[i - 3], line[i - 1] - line[i - 2], line[i] - line[i - 1]].map((x) => Math.round(x)).join(",");
      grams++;
      if (seen.has(key)) repeats++;
      seen.add(key);
    }
  }

  // 時間の中での音の配り方: 1 秒ごとの沈黙の割合と、10 秒ごとの音の数のばらつき
  const second = new Set(sorted.map((n) => Math.floor(n.t)));
  const bins = Array.from({ length: Math.max(1, Math.ceil(span / 10)) }, () => 0);
  for (const n of sorted) bins[Math.min(bins.length - 1, Math.floor((n.t - sorted[0].t) / 10))]++;
  const peak = Math.max(...pitches);
  const lastOnset = onsets.at(-1)!;

  return Object.fromEntries(
    Object.entries({
      notes: notes.length,
      notesPerSecond: notes.length / span,
      range: peak - Math.min(...pitches),
      meanPitch: mean(pitches),
      pitchSd: sd(pitches),
      pitchClasses: new Set(pitches.map(pc)).size,
      rootShare: pitches.filter((m) => pc(m) === rootPc).length / pitches.length,
      endsOnRoot: lastOnset.some((n) => pc(n.midi) === rootPc) ? 1 : 0,
      chordShare: onsets.filter((o) => o.length >= 2).length / onsets.length,
      stepShare: moves.length ? moves.filter((i) => Math.abs(i) <= 2.25).length / moves.length : 0,
      leapShare: moves.length ? moves.filter((i) => Math.abs(i) >= 4.75).length / moves.length : 0,
      repeatShare: grams ? repeats / grams : 0,
      upShare: moves.length ? moves.filter((i) => i > 0).length / moves.length : 0,
      peakAt: (sorted.find((n) => n.midi === peak)!.t - sorted[0].t) / span, // 一番高い音が最初に鳴った位置（0〜1）
      velocityMean: mean(notes.map((n) => n.velocity)),
      velocitySd: sd(notes.map((n) => n.velocity)),
      silenceShare: 1 - second.size / Math.ceil(span),
      densityCv: mean(bins) ? sd(bins) / mean(bins) : 0,
      noteSeconds: mean(notes.map((n) => n.seconds)),
    }).map(([k, v]) => [k, round(v)]),
  );
}

// --- 書き出し ---

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toLocaleDateString("sv");

export function exportJson() {
  download(`sonata-ratings-${stamp()}.json`, "application/json", JSON.stringify(loadRecords(), null, 2));
}

// 入れ子の項目は「settings.tempo」のような列名にして平らにする
export function exportCsv() {
  const rows = loadRecords().map((r) => flatten(r));
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))].join("\n");
  download(`sonata-ratings-${stamp()}.csv`, "text/csv", "﻿" + text); // Excel で文字化けしないよう BOM を付ける
}

function flatten(value: object, prefix = ""): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([k, v]) =>
      v && typeof v === "object" && !Array.isArray(v) ? Object.entries(flatten(v, `${prefix}${k}.`)) : [[`${prefix}${k}`, v]],
    ),
  );
}
