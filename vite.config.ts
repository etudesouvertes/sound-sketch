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

export default defineConfig(({ command }) => ({
  // GitHub Pages では https://etudes-ouvertes.github.io/sound-sketch/ で公開する
  base: command === "build" ? "/sound-sketch/" : "/",
  plugins: [cloudflareAnalytics()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      // Keyboard（keyboard.html）と、試作中の Sonata（sonata.html）は公開しない。開発サーバーでは開ける
      input: {
        main: page("./index.html"),
        ripples: page("./ripples.html"),
        phase: page("./phase.html"),
        loops: page("./loops.html"),
      },
    },
  },
}));
