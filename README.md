# sound-sketch

ブラウザだけで鳴る、ジェネレーティブ音楽のスケッチ集です。
A collection of generative music sketches that play right in your browser.

**https://etudesouvertes.github.io/sound-sketch/**

## 作品 / Pieces

### Sketches

触ると変わり、終わらずに鳴り続ける音楽。ブライアン・イーノとスティーヴ・ライヒの音楽と、その手法への敬意を込めて。
Music that changes as you touch it and never ends. Made with deep respect for the music and ideas of Brian Eno and Steve Reich.

| | |
|---|---|
| **Ripples** | クリックした場所から波紋が広がり、画面の端や別の波紋にぶつかると音が鳴ります。<br>Ripples spread from where you click and sound when they hit the edge or each other. |
| **Phase** | 周期がわずかに違うループが、少しずつずれていきます。スティーヴ・ライヒのフェイジング（『Piano Phase』など）に着想を得ています。<br>Loops with slightly different periods slowly drift apart, inspired by Steve Reich's phasing (e.g. *Piano Phase*). |
| **Loops** | 長さの違うテープループが重なり、同じ響きはほとんど二度と来ません。ブライアン・イーノ『Music for Airports』の手法に着想を得ています。<br>Tape loops of different lengths overlap so the same harmony almost never returns, inspired by Brian Eno's *Music for Airports*. |

### Sonatas

作曲家の手法で作る、3 楽章のピアノソナタ。
Three-movement piano sonatas built from composers' methods.

| | |
|---|---|
| **Sonata** | 作曲家がピアノソナタを書いたら、という試みです。エリック・サティ、オリヴィエ・メシアン、ジョン・ケージ、コンロン・ナンカロウ、ジェルジ・リゲティ、モートン・フェルドマン、一柳慧、テリー・ライリー、アルヴォ・ペルト、スティーヴ・ライヒ、フィリップ・グラス、ブライアン・イーノの 12 人について、曲そのものは引用せず、作り方だけを借りた 3 楽章のソナタが鳴ります。12 人の音楽と、その手法への敬意を込めて。<br>What if these composers wrote a piano sonata? For each of twelve composers — Erik Satie, Olivier Messiaen, John Cage, Conlon Nancarrow, György Ligeti, Morton Feldman, Toshi Ichiyanagi, Terry Riley, Arvo Pärt, Steve Reich, Philip Glass and Brian Eno — a three-movement sonata borrows their methods, never their pieces. Made with deep respect for their music and ideas. |

どの作品も、日本・中国・中近東・インド・バリ島などのスケール、現在地の天気、何分もかけたゆっくりした変化で、音が移り変わります。
Each piece can use scales from Japan, China, the Middle East, India, Bali and more, follow the current weather, and slowly evolve over many minutes.

音が出ないときは、iPhone のマナーモードを解除してください。
No sound? On iPhone, turn off silent mode.

## 使っているもの / Built with

- [Tone.js](https://tonejs.github.io/)（MIT License）と Web Audio API（AudioWorklet を含む）
- [Vite](https://vite.dev/) + TypeScript
- 天気データ / Weather data: [Open-Meteo.com](https://open-meteo.com/)（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）
- ピアノの音 / Piano samples: Salamander Grand Piano V3 by Alexander Holm（[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)）

「天気」をオンにして「現在地」を選ぶと、ブラウザの位置情報を小数点以下 2 桁（約 1 km）に丸めて Open-Meteo に送ります。
アクセス数の計測に [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) を使っています。Cookie を使わず、個人を特定する情報は集めません。
それ以外の情報は送信しません。ブラウザには、表示言語と説明のオン・オフだけを保存します。

When weather is on with “Current location”, your browser location is rounded to two decimal places (about 1 km) and sent to Open-Meteo.
Page views are measured with [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/), which uses no cookies and collects no personally identifying information.
Nothing else is sent. Only your language and help on/off choices are stored in your browser.

## 開発 / Development

```sh
docker compose up -d   # http://localhost:5180
```

`main` に push すると、GitHub Actions でビルドして GitHub Pages に公開します。
Pushing to `main` builds and deploys to GitHub Pages via GitHub Actions.

開発サーバーでは、音源やエフェクトを試すための Keyboard のページ（`/keyboard.html`）も開けます。公開版には含めていません。
The development server also serves a Keyboard page (`/keyboard.html`) for trying instruments and effects. It is not part of the published site.

## ライセンス / License

[MIT License](./LICENSE) © 2026 Tomonori Yoshida

コードを使ったり参考にしたりしたときは、名前（Tomonori Yoshida）やこのリポジトリへのリンクを添えてもらえるとうれしいです。
If you use or build on this code, I'd appreciate a mention of my name (Tomonori Yoshida) or a link to this repository.

各作品が鳴らす音楽（録音を含む）は [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) で使えます。「Music: Tomonori Yoshida / sound-sketch」のように名前を添えてください。ピアノの音を使う作品の録音には「Piano: Salamander Grand Piano by Alexander Holm (CC BY 3.0)」も添えてください。
The music the pieces play, including recordings of it, is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Please credit it as, for example, “Music: Tomonori Yoshida / sound-sketch”. Recordings of pieces that use the piano should also credit “Piano: Salamander Grand Piano by Alexander Holm (CC BY 3.0)”.

本作は、ここで名前を挙げた作曲家および関係者とは関係のない、個人の作品です。
This is a personal project, not affiliated with any of the composers named here or their representatives.
