import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// Cloudflare Web Analytics（Cookie を使わないアクセス計測）。開発中の閲覧を数えないよう、本番用ビルドにだけ入れる
const CLOUDFLARE_BEACON_TOKEN = "e10f97cdff534db986140a33b408f500";

function cloudflareAnalytics(): Plugin {
  return {
    name: "cloudflare-web-analytics",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "script",
        attrs: {
          type: "module",
          src: "https://static.cloudflareinsights.com/beacon.min.js",
          "data-cf-beacon": JSON.stringify({ token: CLOUDFLARE_BEACON_TOKEN }),
        },
        injectTo: "body",
      },
    ],
  };
}

// <!-- unpublished --> 〜 <!-- /unpublished --> で囲んだ部分（公開前の作品へのリンクなど）を、本番用ビルドから外す。開発サーバーでは見える
function stripUnpublished(): Plugin {
  return {
    name: "strip-unpublished",
    apply: "build",
    transformIndexHtml: (html) => html.replace(/[ \t]*<!-- unpublished -->[\s\S]*?<!-- \/unpublished -->\n?/g, ""),
  };
}

// SNS でリンクを貼ったときのカード（OGP）。画像は public/og.png、URL は公開先の絶対 URL にする
const SITE_URL = "https://etudesouvertes.github.io/sound-sketch/";

const OGP_PAGES: Record<string, { title: string; description: string }> = {
  "index.html": {
    title: "sound-sketch",
    description: "ブラウザだけで鳴る、ジェネレーティブ音楽のスケッチ集。A collection of generative music sketches that play in your browser.",
  },
  "ripples.html": {
    title: "Ripples - sound-sketch",
    description: "クリックした場所から波紋が広がり、ぶつかると音が鳴ります。Ripples spread from where you click and sound when they hit.",
  },
  "phase.html": {
    title: "Phase - sound-sketch",
    description: "周期がわずかに違うループが、少しずつずれていきます。Loops with slightly different periods slowly drift apart.",
  },
  "loops.html": {
    title: "Loops - sound-sketch",
    description: "長さの違うテープループが重なり、同じ響きはほとんど二度と来ません。Tape loops of different lengths overlap, so the same harmony almost never returns.",
  },
  "tape.html": {
    title: "Tape - sound-sketch",
    description: "弾いた音が 1 本のテープに録り重ねられ、1 周ごとに遠ざかっていきます。What you play is layered onto a tape loop and drifts further away each time round.",
  },
  "radio.html": {
    title: "Radio - sound-sketch",
    description: "何台もの短波受信機で世界のラジオを拾い、局のあいだのうなりがスケールの音を鳴らします。Shortwave receivers pick up radio from around the world; between stations, the beat tones play a scale.",
  },
  "sonata.html": {
    title: "Sonata - sound-sketch",
    description: "12 人の作曲家の作り方だけを借りた、3 楽章のピアノソナタ。Three-movement piano sonatas built from twelve composers' methods.",
  },
  "duo.html": {
    title: "Duo - sound-sketch",
    description: "二人のギタリストが、2 台のピアノで連弾したら。As if two guitarists sat down at two pianos.",
  },
};

function ogp(): Plugin {
  return {
    name: "ogp",
    apply: "build",
    transformIndexHtml: (_html, ctx) => {
      const file = ctx.filename.split("/").pop() ?? "";
      const page = OGP_PAGES[file];
      if (!page) return [];
      const url = file === "index.html" ? SITE_URL : SITE_URL + file;
      const meta = (attr: "property" | "name", key: string, content: string) => ({
        tag: "meta",
        attrs: { [attr]: key, content },
        injectTo: "head" as const,
      });
      return [
        meta("property", "og:type", "website"),
        meta("property", "og:site_name", "sound-sketch"),
        meta("property", "og:title", page.title),
        meta("property", "og:description", page.description),
        meta("property", "og:url", url),
        // 画像を差し替えたら v を上げる（X などが古い画像を覚えているため）
        meta("property", "og:image", SITE_URL + "og.png?v=2"),
        meta("property", "og:image:width", "1200"),
        meta("property", "og:image:height", "630"),
        meta("property", "og:image:alt", "sound-sketch — Études ouvertes"),
        meta("name", "twitter:card", "summary_large_image"),
      ];
    },
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages では https://etudesouvertes.github.io/sound-sketch/ で公開する
  base: command === "build" ? "/sound-sketch/" : "/",
  plugins: [cloudflareAnalytics(), stripUnpublished(), ogp()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      // Keyboard（keyboard.html）は公開しない。開発サーバーでは開ける
      input: {
        main: page("./index.html"),
        ripples: page("./ripples.html"),
        phase: page("./phase.html"),
        loops: page("./loops.html"),
        tape: page("./tape.html"),
        radio: page("./radio.html"),
        sonata: page("./sonata.html"),
        duo: page("./duo.html"),
      },
    },
  },
}));
