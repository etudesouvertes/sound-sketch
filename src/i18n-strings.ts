// HTML や共通の部品に出す文言の辞書。キーは data-i18n / data-i18n-aria や tk() で使う。
// 説明文は help-texts.ts、スケール名は scales.ts、都市名は weather.ts にまとめてある

// ヒントの最後に足す、音が出ないときの案内
const SILENT_NOTE = {
  ja: "\n音が出ないときは、iPhone のマナーモードを解除してください",
  en: "\nNo sound? On iPhone, turn off silent mode.",
};

export const STRINGS: Record<string, { ja: string; en: string }> = {
  // 上のバー
  clear: { ja: "クリア", en: "Clear" },
  restart: { ja: "最初から", en: "From the top" },
  composer: { ja: "作曲家", en: "Composer" },
  movement: { ja: "楽章", en: "Movement" },
  transport: { ja: "再生", en: "Playback" },
  play: { ja: "再生", en: "Play" },
  playStop: { ja: "停止", en: "Stop" },
  playRepeat: { ja: "ずっと再生", en: "Keep playing" },
  playShuffle: { ja: "シャッフル再生", en: "Shuffle" },
  settings: { ja: "⚙ 設定", en: "⚙ Settings" },
  settingsPanel: { ja: "設定", en: "Settings" },
  settingsClose: { ja: "設定を閉じる", en: "Close settings" },
  showMenu: { ja: "メニューを表示", en: "Show menu" },
  help: { ja: "? 説明", en: "? Help" },
  helpClose: { ja: "閉じる", en: "Close" },
  helpAbout: { ja: "の説明", en: " — help" },
  record: { ja: "● 録音", en: "● Rec" },
  stop: { ja: "■ 停止", en: "■ Stop" },

  // 設定パネルの見出し
  "sec.sound": { ja: "音", en: "Sound" },
  "sec.loop": { ja: "ループ", en: "Loop" },
  "sec.weather": { ja: "天気", en: "Weather" },
  "sec.drift": { ja: "変化", en: "Drift" },
  "sec.auto": { ja: "自動", en: "Auto" },
  "sec.repeat": { ja: "反復", en: "Repetition" },

  // 設定パネルの項目
  scale: { ja: "スケール", en: "Scale" },
  root: { ja: "主音", en: "Root" },
  register: { ja: "音域", en: "Register" },
  density: { ja: "密度", en: "Density" },
  sway: { ja: "揺らぎ", en: "Sway" },
  reverbLevel: { ja: "響き", en: "Reverb" },
  tuning: { ja: "調律", en: "Tuning" },
  "sec.performance": { ja: "演奏", en: "Performance" },
  seed: { ja: "種", en: "Seed" },
  seedKeep: { ja: "今の演奏の種を使う", en: "Use this performance's seed" },
  ratingPrompt: { ja: "この楽章は", en: "This movement:" },
  "rating.good": { ja: "良い", en: "Good" },
  "rating.ok": { ja: "普通", en: "OK" },
  "rating.bad": { ja: "ダメ", en: "Bad" },
  ratingCount: { ja: "評価の記録（件）", en: "Ratings saved" },
  ratingJson: { ja: "JSON で書き出す", en: "Export JSON" },
  ratingCsv: { ja: "CSV で書き出す", en: "Export CSV" },
  ratingClear: { ja: "消す", en: "Delete" },
  "tuning.exact": { ja: "ぴったり", en: "In tune" },
  "tuning.loose": { ja: "少しずれ", en: "Slightly off" },
  "tuning.old": { ja: "古いピアノ", en: "Old piano" },
  prepared: { ja: "プリペアド・ピアノ", en: "Prepared piano" },
  mode: { ja: "種類", en: "Type" },
  "mode.note": { ja: "単音", en: "Single note" },
  "mode.phrase": { ja: "フレーズ", en: "Phrase" },
  phraseLength: { ja: "音数", en: "Notes" },
  tempo: { ja: "テンポ", en: "Tempo" },
  phraseNew: { ja: "フレーズを作り直す", en: "New phrase" },
  fade: { ja: "減衰", en: "Fade out" },
  useWeather: { ja: "天気を使う", en: "Use weather" },
  place: { ja: "場所", en: "Place" },
  driftOn: { ja: "ゆっくり変化させる", en: "Slowly evolve" },
  driftSpeed: { ja: "速さ", en: "Speed" },
  autoOn: { ja: "自動で置く", en: "Place automatically" },

  // キャンバスのページのヒント
  "hint.ripples": {
    ja: "クリックすると波紋が広がり、ぶつかると音が鳴ります" + SILENT_NOTE.ja,
    en: "Click to send out ripples. They make sounds when they collide." + SILENT_NOTE.en,
  },
  "hint.phase": {
    ja: "クリックで音を置く。縦の位置で音の高さ、横の位置でループの周期が決まります\n周期がわずかに違う音どうしは、少しずつずれていきます" + SILENT_NOTE.ja,
    en: "Click to place a note. Height sets the pitch, horizontal position sets the loop period.\nNotes with slightly different periods slowly drift apart." + SILENT_NOTE.en,
  },
  "hint.loops": {
    ja: "クリックでテープループを置く。縦の位置で音の高さ、横の位置でループの長さ（15〜35 秒）が決まります\n長さの違うループが重なり、同じ響きはほとんど二度と来ません。ループの中心をクリックすると外せます\n「録音」を押してクリックで演奏し、「停止」を押すと、そのフレーズが録音した長さのループになります" + SILENT_NOTE.ja,
    en: "Click to place a tape loop. Height sets the pitch, horizontal position sets the loop length (15–35 s).\nLoops of different lengths overlap, so the same harmony almost never returns. Click a loop's center to remove it.\nPress “Rec”, play by clicking, then press “Stop” to turn the phrase into a loop of the recorded length." + SILENT_NOTE.en,
  },
  "hint.sonata": {
    ja: "クリックすると、ソナタが I 楽章から始まります。3 つの楽章が続けて鳴り、III が終わるとソナタも終わります\n演奏中にクリックすると、その高さの音が音楽に加わります" + SILENT_NOTE.ja,
    en: "Click to start the sonata from movement I. The three movements play in turn, and the sonata ends after III.\nClick while it plays to add a note at that height to the music." + SILENT_NOTE.en,
  },

  // トップページ
  "home.lead": {
    ja: "ブラウザだけで鳴る、ジェネレーティブ音楽のスケッチ集です。",
    en: "A collection of generative music sketches that play right in your browser.",
  },
  "home.sketches": {
    ja: "触ると変わり、終わらずに鳴り続ける音楽。",
    en: "Music that changes as you touch it and never ends.",
  },
  "home.ripples": {
    ja: "波紋が広がり、ぶつかると音が鳴ります。",
    en: "Ripples spread out and make sounds when they collide.",
  },
  "home.phase": {
    ja: "周期がわずかに違うループが、少しずつずれていきます。",
    en: "Loops with slightly different periods slowly drift apart.",
  },
  "home.loops": {
    ja: "長さの違うテープループが重なり、同じ響きはほとんど二度と来ません。",
    en: "Tape loops of different lengths overlap, so the same harmony almost never returns.",
  },
  "home.respect": {
    ja: "ブライアン・イーノとスティーヴ・ライヒの音楽と、その手法への敬意を込めて。",
    en: "Made with deep respect for the music and ideas of Brian Eno and Steve Reich.",
  },
  "home.sonatas": {
    ja: "作曲家の手法で作る、3 楽章のピアノソナタ。",
    en: "Three-movement piano sonatas built from composers' methods.",
  },
  "home.sonata": {
    ja: "サティからイーノまで 12 人の作曲家。作品ではなく作り方を借りて、作曲家ごとのソナタが鳴ります。",
    en: "Twelve composers, from Satie to Eno. Each sonata borrows a composer's methods, not their pieces.",
  },
  "home.sonataRespect": {
    ja: "エリック・サティ、オリヴィエ・メシアン、ジョン・ケージ、コンロン・ナンカロウ、ジェルジ・リゲティ、モートン・フェルドマン、一柳慧、テリー・ライリー、アルヴォ・ペルト、スティーヴ・ライヒ、フィリップ・グラス、ブライアン・イーノの音楽と、その手法への敬意を込めて。",
    en: "Made with deep respect for the music and ideas of Erik Satie, Olivier Messiaen, John Cage, Conlon Nancarrow, György Ligeti, Morton Feldman, Toshi Ichiyanagi, Terry Riley, Arvo Pärt, Steve Reich, Philip Glass and Brian Eno.",
  },
  "home.note": {
    ja: "音が出ないときは、iPhone のマナーモードを解除してください。ヘッドホンでの視聴がおすすめです。",
    en: "No sound? On iPhone, turn off silent mode. Headphones are recommended.",
  },
  "home.disclaimer": {
    ja: "本作は、名前を挙げた作曲家および関係者とは関係のない、個人の作品です。",
    en: "This is a personal project, not affiliated with any of the composers named here or their representatives.",
  },

  // Keyboard
  instrument: { ja: "音源", en: "Instrument" },
  waveform: { ja: "波形", en: "Waveform" },
  volume: { ja: "音量", en: "Volume" },
  reverb: { ja: "リバーブ", en: "Reverb" },
  transpose: { ja: "トランスポーズ", en: "Transpose" },
  octave: { ja: "オクターブ", en: "Octave" },
  worklet: { ja: "Worklet（自作）", en: "Worklet (custom)" },
  "hint.keyboard": {
    ja: "クリック、または PC キーボードで演奏\n下段 Z S X D C V G B H N J M（C4〜B4）／ 上段 Q 2 W 3 E R 5 T 6 Y 7 U I（C5〜C6）" + SILENT_NOTE.ja,
    en: "Play by clicking or with your computer keyboard\nLower row Z S X D C V G B H N J M (C4–B4) / upper row Q 2 W 3 E R 5 T 6 Y 7 U I (C5–C6)" + SILENT_NOTE.en,
  },
};
