// 公開しているページの名前と説明。検索結果の説明とリンクカード（description・OGP、vite.config.ts）と、投稿用の動画の説明（record.ts）で使う。
// 新しいページを公開するときは、ここに足す
export const SITE_URL = "https://etudesouvertes.github.io/sound-sketch/";

export const OGP_PAGES: Record<string, { title: string; description: string }> = {
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
    description: "二人の弦楽器奏者、ドラマー、ギタリスト、録音技師、コラ奏者が、左右 2 台のピアノで連弾したら。As if two string players, drummers, guitarists, recording engineers or kora players sat down at two pianos, left and right.",
  },
};
