// Sonata を 1 つ録り、YouTube 用の mp4 と SoundCloud 用の flac に変換する。
// 使い方: docker compose run --rm recorder [--composer satie] [--seed 12345] [--short]
//   --composer を省くと作曲家をでたらめに選び、--seed を省くと新しい Op. を引く。--short は楽章を 5 分の 1 の長さにする（試すとき用）
// 書き出し先は recordings/（同じ名前の .webm・.json・.mp4・.flac）
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({
  options: {
    composer: { type: "string" },
    seed: { type: "string" },
    short: { type: "boolean", default: false },
    base: { type: "string", default: process.env.SONATA_URL ?? "https://localhost:5173/sonata.html" },
    out: { type: "string", default: "/recordings" },
  },
});

const url = new URL(values.base);
url.searchParams.set("record", "");
if (values.composer) url.searchParams.set("composer", values.composer);
if (values.seed) url.searchParams.set("seed", values.seed);
if (values.short) url.searchParams.set("short", "");
mkdirSync(values.out, { recursive: true });

// 古いヘッドレス（headless shell）ではキャンバスの録画がコマ落ちするので、新しいヘッドレスモードの Chromium を使う
const browser = await chromium.launch({ channel: "chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
// 開発サーバーは自己署名の証明書の https なので、証明書の警告は無視する
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: "en-US", acceptDownloads: true, ignoreHTTPSErrors: true });
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[page ${m.type()}] ${m.text()}`);
});
const saves = [];
page.on("download", (d) => saves.push(d.saveAs(`${values.out}/${d.suggestedFilename()}`)));

console.log(`recording ${url}`);
await page.goto(url.href);
const started = Date.now();
const timer = setInterval(() => console.log(`  ${Math.round((Date.now() - started) / 1000)} s`), 60_000);
const handle = await page.waitForFunction(
  () => {
    const r = window.__record;
    return r && (r.state === "done" || r.state === "error") ? r : null;
  },
  null,
  { timeout: 60 * 60_000, polling: 2000 },
);
clearInterval(timer);
const result = await handle.jsonValue();
await Promise.all(saves);
await browser.close();
if (result.state === "error") {
  console.error(`failed: ${result.detail}`);
  process.exit(1);
}

const name = `${values.out}/${result.detail}`;
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
// 音量: いちばん大きい所が -1 dB になるよう、全体を同じだけ上げる（強弱の差は変えない）
const detected = spawnSync("ffmpeg", ["-hide_banner", "-i", `${name}.webm`, "-vn", "-af", "volumedetect", "-f", "null", "-"]).stderr.toString();
const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(detected)?.[1] ?? -1);
const gain = `volume=${(-1 - peak).toFixed(1)}dB`;
console.log(`peak ${peak} dB → ${gain}`);
// 頭の真っ黒な所（record.ts の LEAD）が明けた時刻。ここから使う（webm の頭は欠けていることがある）
const black = spawnSync("ffmpeg", ["-hide_banner", "-i", `${name}.webm`, "-an", "-vf", "blackdetect=d=0.5:pix_th=0.02", "-f", "null", "-"]).stderr.toString();
const from = /black_end:([\d.]+)/.exec(black)?.[1] ?? "0";
console.log(`start at ${from} s`);
// MediaRecorder の webm は長さや時刻の情報が欠けることがあるので、作り直してから使う
ffmpeg("-ss", from, "-i", `${name}.webm`, "-af", gain, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", `${name}.mp4`);
ffmpeg("-ss", from, "-i", `${name}.webm`, "-vn", "-af", gain, "-c:a", "flac", `${name}.flac`);
console.log(`done: ${name}.{webm,json,mp4,flac}`);
