import * as Tone from "tone";

// 録音モード（?record）: ソナタを 1 つ、始まりのカードから終わりのクレジットまで録り、動画（webm）と情報（JSON）を書き出す。
// 録るのは recorder/record-sonata.mjs（ヘッドレスの Chrome）。人が開いても動くが、書き出したファイルはダウンロードに入る。
// 画面の文字は英語で出す（動画は国を問わず聴いてもらうため）

// MediaRecorder の webm は、頭の数秒（最初のキーフレームを含む）が欠けることがある。録り始めてから LEAD 秒は画面を真っ黒にしておき、
// 変換するときに黒が明けた所から使う（record-sonata.mjs）
const LEAD = 4;
const INTRO = 6; // 始まりのカードを出す長さ（秒。この間は無音）
const TAIL = 4; // ソナタが終わってから、残響が消えるのを待つ長さ（秒）
const OUTRO = 8; // 終わりのクレジットを出す長さ（秒）
const FADE = 1.2;

export const CREDITS = [
  "Music: Études ouvertes / sound-sketch",
  "Piano: Salamander Grand Piano by Alexander Holm (CC BY 3.0)",
];

export type RecordingInfo = {
  composer: string;
  composerId: string;
  movements: { title: string; duration: number }[];
  seed: string;
};

type Card = { lines: string[]; footer?: string; from: number; until: number };

// スクリプトが進み具合を見るための印（window.__record）
type State = "loading" | "recording" | "done" | "error";
const report = (state: State, detail?: string) => {
  (window as Window & { __record?: { state: State; detail?: string } }).__record = { state, detail };
};

export function recordSonata(options: {
  canvas: HTMLCanvasElement;
  ready: () => Promise<unknown>; // ピアノの録音を読み終えたら解決する
  info: () => RecordingInfo;
  start: () => void; // ソナタを I から鳴らす
  ended: () => boolean;
}): (g: CanvasRenderingContext2D, width: number, height: number) => void {
  document.body.classList.add("recording");
  report("loading");

  const logo = new Image();
  logo.src = `${import.meta.env.BASE_URL}favicon.svg`;
  let card: Card | null = null;
  let leading = false;

  const run = async () => {
    await options.ready();
    await Tone.start(); // ヘッドレスの Chrome は --autoplay-policy=no-user-gesture-required で、操作なしに音を出せる
    const audio = Tone.getContext().createMediaStreamDestination();
    Tone.getDestination().connect(audio);
    // 鳴っている音がないと、音声トラックにデータが流れず、MediaRecorder は最初の音まで映像も録らない。値 0 の信号を流し続けておく
    const keepAlive = Tone.getContext().createConstantSource();
    keepAlive.offset.value = 0;
    keepAlive.connect(audio);
    keepAlive.start();
    const stream = new MediaStream([...options.canvas.captureStream(30).getVideoTracks(), ...audio.stream.getAudioTracks()]);
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

    const info = options.info();
    const now = () => performance.now() / 1000;
    card = {
      lines: ["Études ouvertes", `Sonata — ${info.composer}`],
      footer: `Op. ${info.seed}`,
      from: now(),
      until: now() + INTRO,
    };
    await wait(INTRO);
    card = null;
    options.start();
    while (!options.ended()) await wait(0.5);
    await wait(TAIL);
    card = { lines: CREDITS, footer: `etudesouvertes.github.io/sound-sketch/sonata.html?composer=${info.composerId}&seed=${info.seed}`, from: now(), until: now() + OUTRO };
    await wait(OUTRO);
    recorder.stop();
    await stopped;

    const name = `sonata-${info.composerId}-op${info.seed}`;
    download(new Blob(chunks, { type: "video/webm" }), `${name}.webm`);
    download(new Blob([JSON.stringify({ ...info, credits: CREDITS, recordedAt: new Date().toISOString() }, null, 2)], { type: "application/json" }), `${name}.json`);
    report("done", name);
  };
  run().catch((e) => {
    console.error(e);
    report("error", String(e));
  });

  // カードを、フェードしながら画面の真ん中に重ねる（後ろの絵はそのまま動き続ける）
  return (g, width, height) => {
    if (leading) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, width, height);
    }
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
      g.fillText(line, width / 2, top + size + 60 * unit + i * 44 * unit);
    });
    if (card.footer) {
      g.font = `${20 * unit}px system-ui, sans-serif`;
      g.fillStyle = "rgba(232, 232, 236, 0.55)";
      g.fillText(card.footer, width / 2, top + size + 60 * unit + card.lines.length * 44 * unit + 16 * unit);
    }
    g.restore();
  };
}

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
