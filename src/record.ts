import * as Tone from "tone";
import { OGP_PAGES, SITE_URL } from "./pages";

// 録音モード（?record）: 投稿用の動画を録る。始まりのカード、演奏、終わりのクレジットを録り、動画（webm）・情報（JSON）・
// サムネイルの元にする 1 コマ（png）を書き出す。録るのは recorder/record.mjs（ヘッドレスの Chrome）。
// 人が開いても動くが、書き出したファイルはダウンロードに入る。画面の文字は英語で出す（動画は国を問わず聴いてもらうため）
// - ?length=秒: その長さだけ鳴らし、音を絞って終える。付けないときは、終わりのある作品（Sonata・Duo）は終わりまで、ほかは 10 分
// - ?vertical: 縦長の短い動画用に、カードとクレジットを短くする（画面の大きさは録る側が決める）
// 録るのはページのキャンバスだけ（バーや設定などの HTML は映らない）。キャンバスの絵に、カードを重ねた別のキャンバスを録る

const query = new URLSearchParams(location.search);
export const RECORD = query.has("record");
const VERTICAL = query.has("vertical");
const LENGTH = Number(query.get("length")) || null;
const ENDLESS_LENGTH = 600; // 終わりのない作品の長さ（秒）

// MediaRecorder の webm は、頭の数秒（最初のキーフレームを含む）が欠けることがある。録り始めてから LEAD 秒は画面を真っ黒にしておき、
// 変換するときに黒が明けた所から使う（record.mjs）
const LEAD = 4;
const INTRO = VERTICAL ? 3 : 6; // 始まりのカードを出す長さ（秒。この間は無音）
const TAIL = 4; // 終わりのある作品が終わってから、残響が消えるのを待つ長さ（秒）
const FADE_OUT = VERTICAL ? 3 : 8; // 長さを決めて録るときに、音を絞る長さ（秒）
const OUTRO = VERTICAL ? 5 : 8; // 終わりのクレジットを出す長さ（秒）
const FADE = 1.2;
const STILL_AT = 0.5; // サムネイルの元にする 1 コマを取る時刻（演奏の長さに対する割合。終わりのある作品は 90 秒）

export const MUSIC_CREDIT = "Music: Études ouvertes / sound-sketch";
export const PIANO_CREDIT = "Piano: Salamander Grand Piano by Alexander Holm (CC BY 3.0)";

// ページが渡す、この演奏の情報
export type RecordingInfo = {
  slug: string; // ファイルの名前（例: ripples、sonata-satie-op12345）
  title: string; // 動画の題（例: Ripples、Sonata in D Dorian, Op. 12345 — after Erik Satie）
  link: string; // 同じ演奏（または同じページ）を開く URL
  credits?: string[]; // 音楽のクレジットのあとに添える行（ピアノの音、放送など）
  details?: Record<string, unknown>; // 楽章など、投稿の説明に使えそうなこと
};

// このページの名前（ripples など）と、公開している URL・説明
const file = location.pathname.split("/").pop() || "index.html";
export const pageName = file.replace(/\.html$/, "");
export const pageLink = SITE_URL + file;
export const pageTitle = (OGP_PAGES[file]?.title ?? pageName).replace(/ - sound-sketch$/, "");

type Card = { lines: string[]; footer?: string; from: number; until: number };

// スクリプトが進み具合を見るための印（window.__record）
type State = "loading" | "recording" | "done" | "error";
const report = (state: State, detail?: string) => {
  (window as Window & { __record?: { state: State; detail?: string } }).__record = { state, detail };
};

export function setupRecording(options: {
  canvas: HTMLCanvasElement; // ページのキャンバス
  ready?: () => Promise<unknown>; // 音源を読み終えたら解決する
  start: () => void; // 演奏を始める
  ended?: () => boolean; // 終わりのある作品が終わったか
  info: () => RecordingInfo;
}) {
  document.body.classList.add("recording");
  report("loading");

  const logo = new Image();
  logo.src = `${import.meta.env.BASE_URL}favicon.svg`;
  let card: Card | null = null;
  let leading = false;

  // 録るキャンバス: ページのキャンバスの絵の上に、カードを重ねる
  const out = document.createElement("canvas");
  const g = out.getContext("2d")!;
  const frame = () => {
    if (out.width !== options.canvas.width || out.height !== options.canvas.height) {
      out.width = options.canvas.width;
      out.height = options.canvas.height;
    }
    g.drawImage(options.canvas, 0, 0);
    if (leading) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, out.width, out.height);
    }
    drawCard(out.width, out.height);
    requestAnimationFrame(frame);
  };

  const run = async () => {
    await options.ready?.();
    await Tone.start(); // ヘッドレスの Chrome は --autoplay-policy=no-user-gesture-required で、操作なしに音を出せる
    const audio = Tone.getContext().createMediaStreamDestination();
    Tone.getDestination().connect(audio);
    // 鳴っている音がないと、音声トラックにデータが流れず、MediaRecorder は最初の音まで映像も録らない。値 0 の信号を流し続けておく
    const keepAlive = Tone.getContext().createConstantSource();
    keepAlive.offset.value = 0;
    keepAlive.connect(audio);
    keepAlive.start();
    frame();
    const stream = new MediaStream([...out.captureStream(30).getVideoTracks(), ...audio.stream.getAudioTracks()]);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8,opus",
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 320_000,
    });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (e) => chunks.push(e.data));
    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve));
    recorder.start(1000);
    report("recording");
    leading = true;
    await wait(LEAD);
    leading = false;

    // 始まりのカードは名乗りだけ。曲名などは、ページが自分で出す（Sonata・Duo の表題など）
    const now = () => performance.now() / 1000;
    card = { lines: ["Études ouvertes"], from: now(), until: now() + INTRO };
    await wait(INTRO);
    card = null;
    options.start();
    const startedAt = now();

    const length = LENGTH ?? (options.ended ? null : ENDLESS_LENGTH);
    const stillAt = startedAt + (length ? length * STILL_AT : 90);
    let still: Promise<Blob | null> | null = null;
    const takeStill = () => (still ??= new Promise((resolve) => options.canvas.toBlob(resolve, "image/png")));
    if (length) {
      while (now() < startedAt + length) {
        if (now() >= stillAt) void takeStill();
        await wait(0.5);
      }
      // 音を絞って終える（作品のほうは鳴り続けている）
      Tone.getDestination().volume.rampTo(-80, FADE_OUT);
      await wait(FADE_OUT + 0.5);
    } else {
      while (!options.ended!()) {
        if (now() >= stillAt) void takeStill();
        await wait(0.5);
      }
      await wait(TAIL);
    }
    const played = now() - startedAt;
    void takeStill(); // 短い作品で、取る時刻が来なかったとき

    const info = options.info();
    const credits = [MUSIC_CREDIT, ...(info.credits ?? [])];
    card = { lines: credits, footer: info.link.replace(/^https:\/\//, ""), from: now(), until: now() + OUTRO };
    await wait(OUTRO);
    recorder.stop();
    await stopped;

    const name = VERTICAL ? `${info.slug}-vertical` : info.slug;
    download(new Blob(chunks, { type: "video/webm" }), `${name}.webm`);
    const png = await still;
    if (png && !VERTICAL) download(png, `${name}.png`);
    const description = OGP_PAGES[file]?.description ?? "";
    const meta = {
      page: pageName,
      ...info,
      credits,
      description,
      format: VERTICAL ? "vertical" : "horizontal",
      seconds: Math.round(played),
      recordedAt: new Date().toISOString(),
    };
    download(new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" }), `${name}.json`);
    report("done", name);
  };
  // ページの初期化（setupGenerativePage を呼んだあとの部分）が終わってから始める。options の関数は、ページがあとで作る値を使う
  setTimeout(() =>
    run().catch((e) => {
      console.error(e);
      report("error", String(e));
    }),
  );

  // カードを、フェードしながら画面の真ん中に重ねる（後ろの絵はそのまま動き続ける）。大きさは、描くキャンバスの画素で決める
  function drawCard(width: number, height: number) {
    if (!card) return;
    const t = performance.now() / 1000;
    const alpha = Math.max(0, Math.min(1, (t - card.from) / FADE, (card.until - t) / FADE));
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = "rgba(27, 29, 35, 0.85)";
    g.fillRect(0, 0, width, height);
    const unit = Math.min(width, height) / 1080;
    const size = 96 * unit;
    const top = height / 2 - (size + 40 * unit + card.lines.length * 44 * unit) / 2;
    if (logo.complete) g.drawImage(logo, width / 2 - size / 2, top, size, size);
    g.textAlign = "center";
    g.fillStyle = "#e8e8ec";
    card.lines.forEach((line, i) => {
      g.font = `${(i === 0 ? 36 : 26) * unit}px system-ui, sans-serif`;
      g.fillText(line, width / 2, top + size + 60 * unit + i * 44 * unit, width - 48 * unit);
    });
    if (card.footer) {
      g.font = `${20 * unit}px system-ui, sans-serif`;
      g.fillStyle = "rgba(232, 232, 236, 0.55)";
      g.fillText(card.footer, width / 2, top + size + 60 * unit + card.lines.length * 44 * unit + 16 * unit, width - 48 * unit);
    }
    g.restore();
  }
}

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
