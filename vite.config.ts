import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vite";
import { OGP_PAGES, SITE_URL } from "./src/pages";

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
  // 開発サーバーは https にする（自己署名の証明書）。AudioWorklet・マイク・端末の傾きなどは、安全な接続でしか使えないため、
  // LAN の URL でスマホから開いても使えるようにする。はじめて開くときは、ブラウザの警告を進める
  plugins: [
    cloudflareAnalytics(),
    stripUnpublished(),
    ogp(),
    basicSsl({ name: "sound-sketch-dev", domains: ["localhost", ...(process.env.LAN_HOST ? [process.env.LAN_HOST] : [])] }),
  ],
  // QR コード（src/qr.ts）: 開発サーバーを localhost で開いたときに、スマホで開ける LAN のアドレスにする。
  // アドレスは .env の LAN_HOST から compose.yaml 経由で渡す。本番のビルドでは使わない
  define: {
    __LAN_HOST__: JSON.stringify(command === "serve" ? (process.env.LAN_HOST ?? "") : ""),
  },
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
