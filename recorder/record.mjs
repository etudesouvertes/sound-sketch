// 投稿用の動画を録る。ページを録音モード（?record、src/record.ts）で開いてヘッドレスの Chromium で鳴らし、変換する。
// 使い方: docker compose --profile record run --rm recorder (--page ripples [--page phase …] | --all) [オプション]
//   --format horizontal|vertical|both  横長（YouTube）・縦長の短い動画（ショート・X・Instagram）・両方（既定）
//   --minutes 10   終わりのない作品（Ripples・Phase・Loops・Tape・Radio）の長さ。Sonata・Duo の横長は、終わりまで録る
//   --composer satie / --seed 12345   Sonata・Duo の作品と Op.（省くと、でたらめに選ぶ）
//   --short        Sonata・Duo の楽章を 5 分の 1 の長さにする（試すとき用）
// 書き出し先は recordings/。名前は「日付-ページ…」で、横長は .mp4（YouTube）・.flac（SoundCloud）・-thumbnail.png・.json、
// 縦長は -vertical.mp4・-vertical.json。.json の post に、投稿に使う題と説明文の下書きが入る
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const PAGES = ["ripples", "phase", "loops", "tape", "radio", "sonata", "duo"];
const FINITE = ["sonata", "duo"]; // 終わりのある作品
const VERTICAL_LENGTH = 47; // 縦長の短い動画で鳴らす長さ（秒）。カードとクレジットを足して 60 秒に収める

const { values } = parseArgs({
  options: {
    page: { type: "string", multiple: true, default: [] },
    all: { type: "boolean", default: false },
    format: { type: "string", default: "both" },
    minutes: { type: "string", default: "10" },
    composer: { type: "string" },
    seed: { type: "string" },
    short: { type: "boolean", default: false },
    base: { type: "string", default: process.env.SITE_URL ?? "https://localhost:5173/" },
    out: { type: "string", default: "/recordings" },
  },
});

const pages = values.all ? PAGES : values.page;
const unknown = pages.filter((p) => !PAGES.includes(p));
if (pages.length === 0 || unknown.length > 0) {
  console.error(`--page に ${PAGES.join(" / ")} のどれか、または --all を指定してください${unknown.length ? `（知らないページ: ${unknown.join(", ")}）` : ""}`);
  process.exit(1);
}
const formats = values.format === "both" ? ["horizontal", "vertical"] : [values.format];
if (!formats.every((f) => f === "horizontal" || f === "vertical")) {
  console.error("--format は horizontal / vertical / both のどれかです");
  process.exit(1);
}
mkdirSync(values.out, { recursive: true });
const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // 2026-11-09

// 古いヘッドレス（headless shell）ではキャンバスの録画がコマ落ちするので、新しいヘッドレスモードの Chromium を使う
const browser = await chromium.launch({ channel: "chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });

let failures = 0;
for (const name of pages)
  for (const format of formats) {
    try {
      await record(name, format);
    } catch (e) {
      failures++;
      console.error(`failed: ${name} ${format}: ${e.message ?? e}`);
    }
  }
await browser.close();
process.exit(failures > 0 ? 1 : 0);

async function record(name, format) {
  const vertical = format === "vertical";
  const url = new URL(`${name}.html`, values.base);
  url.searchParams.set("record", "");
  if (vertical) {
    url.searchParams.set("vertical", "");
    url.searchParams.set("length", String(VERTICAL_LENGTH));
  } else if (!FINITE.includes(name)) url.searchParams.set("length", String(Math.round(Number(values.minutes) * 60)));
  if (FINITE.includes(name)) {
    if (values.composer) url.searchParams.set("composer", values.composer);
    if (values.seed) url.searchParams.set("seed", values.seed);
    if (values.short) url.searchParams.set("short", "");
  }

  // 縦長は、スマホと同じ大きさの画面（540×960 の 2 倍の画素）で開き、ページのスマホ向けの配置で録る
  const context = await browser.newContext({
    viewport: vertical ? { width: 540, height: 960 } : { width: 1920, height: 1080 },
    deviceScaleFactor: vertical ? 2 : 1,
    locale: "en-US",
    acceptDownloads: true,
    ignoreHTTPSErrors: true, // 開発サーバーは自己署名の証明書の https
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`  [page ${m.type()}] ${m.text()}`);
  });
  const saves = [];
  page.on("download", (d) => saves.push(d.saveAs(`${values.out}/${date}-${d.suggestedFilename()}`)));

  console.log(`recording ${url}`);
  await page.goto(url.href);
  const started = Date.now();
  const timer = setInterval(() => console.log(`  ${Math.round((Date.now() - started) / 1000)} s`), 60_000);
  try {
    const handle = await page.waitForFunction(
      () => {
        const r = window.__record;
        return r && (r.state === "done" || r.state === "error") ? r : null;
      },
      null,
      { timeout: 60 * 60_000, polling: 2000 },
    );
    const result = await handle.jsonValue();
    await Promise.all(saves);
    if (result.state === "error") throw new Error(result.detail);
    convert(`${values.out}/${date}-${result.detail}`, vertical);
    if (!vertical) await thumbnail(context, `${values.out}/${date}-${result.detail}`);
  } finally {
    clearInterval(timer);
    await context.close();
  }
}

function convert(file, vertical) {
  // 音量: いちばん大きい所が -1 dB になるよう、全体を同じだけ上げる（強弱の差は変えない）
  const detected = spawnSync("ffmpeg", ["-hide_banner", "-i", `${file}.webm`, "-vn", "-af", "volumedetect", "-f", "null", "-"]).stderr.toString();
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(detected)?.[1] ?? -1);
  const gain = `volume=${(-1 - peak).toFixed(1)}dB`;
  // 頭の真っ黒な所（record.ts の LEAD）が明けた時刻。ここから使う（webm の頭は欠けていることがある）
  const black = spawnSync("ffmpeg", ["-hide_banner", "-i", `${file}.webm`, "-an", "-vf", "blackdetect=d=0.5:pix_th=0.02", "-f", "null", "-"]).stderr.toString();
  const from = /black_end:([\d.]+)/.exec(black)?.[1] ?? "0";
  console.log(`  peak ${peak} dB → ${gain}, start at ${from} s`);
  // MediaRecorder の webm は長さや時刻の情報が欠けることがあるので、作り直してから使う
  ffmpeg("-ss", from, "-i", `${file}.webm`, "-af", gain, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", `${file}.mp4`);
  if (!vertical) ffmpeg("-ss", from, "-i", `${file}.webm`, "-vn", "-af", gain, "-c:a", "flac", `${file}.flac`);

  // 投稿に使う題と説明文の下書き
  const meta = JSON.parse(readFileSync(`${file}.json`, "utf8"));
  const [music, ...others] = meta.credits;
  meta.post = {
    title: meta.title,
    description: [
      meta.title,
      "",
      meta.description,
      "",
      `Play it in your browser: ${meta.link}`,
      "",
      `${music} (CC BY 4.0)`,
      ...others,
    ].join("\n"),
  };
  writeFileSync(`${file}.json`, JSON.stringify(meta, null, 2));
  console.log(`  done: ${file}.{mp4${vertical ? "" : ",flac"},json}`);
}

// サムネイル（1280×720）: 演奏の途中の 1 コマ（record.ts が書き出す .png）に、題を重ねる
async function thumbnail(context, file) {
  const meta = JSON.parse(readFileSync(`${file}.json`, "utf8"));
  let still;
  try {
    still = readFileSync(`${file}.png`).toString("base64");
  } catch {
    return; // 1 コマが書き出されなかった
  }
  const [main, sub = ""] = meta.title.split(" — ");
  const escape = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #1b1d23; }
    .still { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .shade { position: absolute; inset: 0; background: linear-gradient(to top, rgba(27, 29, 35, 0.92) 0%, rgba(27, 29, 35, 0.55) 45%, rgba(27, 29, 35, 0) 75%); }
    .text { position: absolute; left: 64px; right: 64px; bottom: 56px; color: #e8e8ec; font-family: Georgia, "Liberation Serif", "DejaVu Serif", serif; }
    .brand { display: flex; align-items: center; gap: 14px; font: 26px system-ui, sans-serif; opacity: 0.85; margin-bottom: 18px; }
    .brand img { width: 44px; height: 44px; }
    .main { font-size: ${main.length > 34 ? 52 : 68}px; line-height: 1.1; }
    .sub { font-size: 30px; font-style: italic; opacity: 0.8; margin-top: 12px; }
  </style></head><body>
    <img class="still" src="data:image/png;base64,${still}">
    <div class="shade"></div>
    <div class="text">
      <div class="brand"><img src="${new URL("favicon.svg", values.base)}">Études ouvertes</div>
      <div class="main">${escape(main)}</div>
      ${sub ? `<div class="sub">${escape(sub)}</div>` : ""}
    </div>
  </body></html>`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${file}-thumbnail.png` });
  await page.close();
  renameSync(`${file}.png`, `${file}-still.png`);
  console.log(`  thumbnail: ${file}-thumbnail.png`);
}
