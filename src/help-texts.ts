import type { L } from "./i18n";

// 説明文。キーは対象のコントロールを指すセレクタ。
// 現在のページへのナビのリンク（a[aria-current="page"]）には、そのページの遊び方を書く。

export type HelpText = { title: L; text: L };

const PAGE_GUIDE = '.nav a[aria-current="page"]';

// キャンバスのページの遊び方の最後に足す、バーの隠れ方の説明
const BAR_NOTE: L = {
  ja: "上のバーは、演奏を始めてから 3 秒操作しないと隠れます。左上の「≡」か H キーで戻せます。",
  en: " The top bar hides after 3 seconds without interaction once you start playing. Bring it back with “≡” at the top left or the H key.",
};

const withBarNote = (text: L): L => ({ ja: text.ja + BAR_NOTE.ja, en: text.en + BAR_NOTE.en });

// Ripples / Phase / Loops に共通のコントロール
export const HELP_COMMON: Record<string, HelpText> = {
  "#settings-toggle": {
    title: { ja: "設定", en: "Settings" },
    text: {
      ja: "スケールや天気などの設定パネルを開け閉めします。パネルを開いたままでも演奏できます。パネル右上の「×」か Esc でも閉じます。",
      en: "Opens and closes the settings panel for scale, weather and more. You can keep playing while it is open. The “×” at its top right or Esc also closes it.",
    },
  },
  '[data-section="sound"] h2': {
    title: { ja: "音", en: "Sound" },
    text: {
      ja: "音の高さと、自動で鳴る音の多さの設定です。",
      en: "Settings for pitch and for how many sounds are placed automatically.",
    },
  },
  '[data-section="weather"] h2': {
    title: { ja: "天気", en: "Weather" },
    text: {
      ja: "選んだ場所の今の天気で、音を変える設定です。",
      en: "Settings for shaping the sound by the current weather at a chosen place.",
    },
  },
  '[data-section="drift"] h2': {
    title: { ja: "変化", en: "Drift" },
    text: {
      ja: "何分もかけて、音がゆっくり移り変わるようにする設定です。",
      en: "Settings for letting the sound slowly evolve over many minutes.",
    },
  },
  '[data-section="auto"] h2': {
    title: { ja: "自動", en: "Auto" },
    text: {
      ja: "操作しなくても、音がひとりでに置かれて鳴り続けるようにする設定です。",
      en: "Settings for letting sounds place themselves and keep playing without you.",
    },
  },
  "#scale": {
    title: { ja: "スケール", en: "Scale" },
    text: {
      ja: "音の高さの選び方（音階）です。日本、中国、中近東、インド、バリ島、西洋から選べます。四分音やガムランの調律のように、ピアノの鍵盤にない音を含むものもあります。",
      en: "The set of pitches to use. Choose from Japan, China, the Middle East, India, Bali and the West. Some include notes that a piano can't play, such as quarter tones or gamelan tunings.",
    },
  },
  "#root": {
    title: { ja: "主音", en: "Root" },
    text: {
      ja: "スケールの基準になる音です。変えると、曲全体の高さが移ります（転調）。",
      en: "The base note of the scale. Changing it shifts the whole piece (a key change).",
    },
  },
  "#register": {
    title: { ja: "音域", en: "Register" },
    text: {
      ja: "画面に割り当てる音の高さの範囲です。1 で 1 オクターブ低く、5 で 1 オクターブ高くなります。3 が標準です。",
      en: "The pitch range mapped to the screen. 1 is an octave lower, 5 is an octave higher, and 3 is the default.",
    },
  },
  "#density": {
    title: { ja: "密度", en: "Density" },
    text: {
      ja: "自動で音が置かれる頻度です。1 でまばらに、5 で多くなります。手でクリックして置く分には影響しません。",
      en: "How often sounds are placed automatically. 1 is sparse, 5 is busy. It doesn't affect what you place by clicking.",
    },
  },
  "#reverb": {
    title: { ja: "響き", en: "Reverb" },
    text: {
      ja: "リバーブの深さと残響の長さです。1 でほぼ響きなし、3 が標準、5 でホールのように深く長く響きます。天気を使うと雲の量で、変化をオンにすると時間とともに、ここで選んだ響きを中心に深さが揺れます。",
      en: "Reverb depth and length. 1 is nearly dry, 3 is the default and 5 is deep and long like a hall. With weather on, cloud cover moves the depth around this setting, and Drift sways it over time.",
    },
  },
  "#weather": {
    title: { ja: "天気", en: "Weather" },
    text: {
      ja: "オンにすると、選んだ場所の今の天気で音が変わります。空模様で音色の明るさと音の長さ（晴れは明るく、雨は短く、雪は柔らかく長く）、気温で速さ、雨で音の多さ、風でずれ方、雲で響きの深さが決まります。15 分ごとに更新します。",
      en: "When on, the current weather at the chosen place shapes the sound: the sky sets the brightness and note length (bright when clear, short in rain, soft and long in snow), temperature the speed, rain the density, wind the spread and clouds the reverb depth. Updates every 15 minutes.",
    },
  },
  "#place": {
    title: { ja: "場所", en: "Place" },
    text: {
      ja: "天気を取る場所です。「現在地」はブラウザの位置情報を使います。許可しない場合は東京の天気を使います。",
      en: "Where to get the weather from. “Current location” uses your browser's location; if you don't allow it, Tokyo's weather is used.",
    },
  },
  "#drift": {
    title: { ja: "変化", en: "Drift" },
    text: {
      ja: "オンにすると、音域・密度・音色の明るさ・響きが何分もかけてゆっくり揺れ、20 分ごとに 5 度上へ転調します。",
      en: "When on, register, density, brightness and reverb sway slowly over many minutes, and the key moves up a fifth every 20 minutes.",
    },
  },
  "#drift-speed": {
    title: { ja: "変化の速さ", en: "Drift speed" },
    text: {
      ja: "変化が進む速さです。×60 にすると、1 時間分の変化を 1 分で聴けます。",
      en: "How fast the drift advances. At ×60 you hear an hour of change in one minute.",
    },
  },
};

export const HELP_BY_PAGE: Record<string, Record<string, HelpText>> = {
  keyboard: {
    [PAGE_GUIDE]: {
      title: { ja: "Keyboard の使い方", en: "How to use Keyboard" },
      text: {
        ja: "Tone.js の音源やエフェクトを試す場所です。鍵盤をクリックするか、PC キーボード（下段 Z〜M、上段 Q〜I）で弾けます。",
        en: "A place to try Tone.js instruments and effects. Click the keys or play with your computer keyboard (lower row Z–M, upper row Q–I).",
      },
    },
    "#instrument": {
      title: { ja: "音源", en: "Instrument" },
      text: {
        ja: "音を作る仕組みを選びます。Worklet（自作）は、自作の処理で 1 サンプルずつ波形を計算する音源です。",
        en: "Chooses how the sound is generated. Worklet (custom) computes the waveform sample by sample with our own code.",
      },
    },
    "#waveform": {
      title: { ja: "波形", en: "Waveform" },
      text: {
        ja: "音のもとになる波の形です。sine は柔らかく、sawtooth は明るく派手な音になります。PluckSynth では使えません。",
        en: "The shape of the underlying wave. sine is soft, sawtooth is bright and buzzy. Not available for PluckSynth.",
      },
    },
    "#volume": { title: { ja: "音量", en: "Volume" }, text: { ja: "全体の音量です。", en: "Overall volume." } },
    "#reverb": {
      title: { ja: "リバーブ", en: "Reverb" },
      text: { ja: "響き（残響）の深さです。", en: "How much reverberation is added." },
    },
    "#transpose": {
      title: { ja: "トランスポーズ", en: "Transpose" },
      text: {
        ja: "鳴る音の高さを半音単位でずらします。鍵盤の見た目は変わりません。",
        en: "Shifts the sounding pitch in semitones. The on-screen keys stay the same.",
      },
    },
    "#octave": {
      title: { ja: "オクターブ", en: "Octave" },
      text: { ja: "鳴る音の高さを 1 オクターブ単位でずらします。", en: "Shifts the sounding pitch in octaves." },
    },
    "#fx-distortion": { title: { ja: "Distortion", en: "Distortion" }, text: { ja: "音を歪ませます。", en: "Distorts the sound." } },
    "#fx-chorus": {
      title: { ja: "Chorus", en: "Chorus" },
      text: { ja: "音を揺らして厚みを出します。", en: "Adds width by gently wobbling the sound." },
    },
    "#fx-delay": {
      title: { ja: "Delay", en: "Delay" },
      text: { ja: "音を 8 分音符の間隔で繰り返します。", en: "Repeats the sound every eighth note." },
    },
  },
  ripples: {
    [PAGE_GUIDE]: {
      title: { ja: "Ripples の遊び方", en: "How to play Ripples" },
      text: withBarNote({
        ja: "クリックした場所から波紋が広がり、画面の端や別の波紋にぶつかると音が鳴ります。鳴るタイミングは 16 分音符に揃うので、どこをクリックしてもリズムが崩れません。画面の上ほど高い音です。",
        en: "Ripples spread from where you click and make sounds when they hit the screen edge or each other. Notes snap to sixteenth notes, so the rhythm holds wherever you click. Higher on the screen means higher pitch.",
      }),
    },
    "#auto": {
      title: { ja: "自動", en: "Auto" },
      text: {
        ja: "オンにすると、平均 4 秒ごとに波紋がひとりでに生まれます。",
        en: "When on, a ripple appears by itself about every 4 seconds.",
      },
    },
    "#clear": {
      title: { ja: "クリア", en: "Clear" },
      text: { ja: "画面上の波紋をすべて消します。", en: "Removes all ripples." },
    },
  },
  phase: {
    [PAGE_GUIDE]: {
      title: { ja: "Phase の遊び方", en: "How to play Phase" },
      text: withBarNote({
        ja: "クリックした場所に音の種を置くと、種が自分の周期で鳴り続けます。縦の位置で音の高さ、横の位置で周期が決まり、周期がわずかに違う種どうしは少しずつずれていきます（スティーヴ・ライヒのフェイジング）。",
        en: "Click to plant a seed that keeps sounding at its own period. Height sets the pitch and horizontal position the period, so seeds with slightly different periods slowly drift apart (Steve Reich's phasing).",
      }),
    },
    '[data-section="loop"] h2': {
      title: { ja: "ループ", en: "Loop" },
      text: {
        ja: "種がどう鳴るかの設定です。音数・テンポ・フレーズを作り直すは、種類が「フレーズ」のときだけ効きます。",
        en: "Settings for how seeds sound. Notes, Tempo and New phrase only apply when Type is “Phrase”.",
      },
    },
    "#mode": {
      title: { ja: "ループ", en: "Loop type" },
      text: {
        ja: "単音は 1 周に 1 音を鳴らします。フレーズは、すべての種が同じフレーズを鳴らします。同じ高さで横に少し離して 2 つ置くと、『Piano Phase』のようなずれが聴けます。",
        en: "Single note plays one note per cycle. Phrase makes every seed play the same phrase. Place two seeds at the same height, slightly apart, to hear Piano Phase–style drifting.",
      },
    },
    "#phrase-length": {
      title: { ja: "音数", en: "Notes" },
      text: {
        ja: "フレーズの音の数です。変えると、新しいフレーズを作ります。",
        en: "The number of notes in the phrase. Changing it creates a new phrase.",
      },
    },
    "#phrase-tempo": {
      title: { ja: "テンポ", en: "Tempo" },
      text: {
        ja: "フレーズの速さ（1 分あたりの音数）です。置いてある種にもすぐ効きます。",
        en: "Phrase speed in notes per minute. Applies to existing seeds immediately.",
      },
    },
    "#phrase-new": {
      title: { ja: "フレーズを作り直す", en: "New phrase" },
      text: {
        ja: "新しいフレーズをランダムに作ります。置いてある種も、次の周から新しいフレーズで鳴ります。",
        en: "Creates a new random phrase. Existing seeds switch to it from their next cycle.",
      },
    },
    "#fade": {
      title: { ja: "減衰", en: "Fade out" },
      text: {
        ja: "オンにすると、種は鳴るたびに少しずつ弱まり、16 回鳴ると消えます。オフにすると鳴り続けます。",
        en: "When on, seeds get quieter each time and disappear after 16 plays. When off, they play forever.",
      },
    },
    "#auto": {
      title: { ja: "自動", en: "Auto" },
      text: {
        ja: "オンにすると、しばらく操作がないときに種がひとりでに置かれます。",
        en: "When on, seeds are planted by themselves after a while without interaction.",
      },
    },
    "#clear": {
      title: { ja: "クリア", en: "Clear" },
      text: { ja: "置いてある種をすべて消します。", en: "Removes all seeds." },
    },
  },
  sonata: {
    [PAGE_GUIDE]: {
      title: { ja: "Sonata の遊び方", en: "How to play Sonata" },
      text: withBarNote({
        ja: "作曲家がピアノソナタを書いたら、という試みです。作曲家ごとに独立した 3 楽章のソナタで、曲そのものは引用せず、作り方だけを借りています。楽章はそれぞれ数分の流れ（始まり・盛り上がり・終わり）を持ち、I → II → III と続けて鳴ります。演奏中にクリックすると、その高さの音が音楽に加わります。背景の大譜表は、画面を音階の音 1 つにつき 1 段に分け、線の音（ミ・ソ・シ・レ・ファなど）の段に線を引いています。そのため、7 音でない音階では、五線の間隔が等間隔になりません。音名は 7 つしかないので、8 音の音階（メシアン）ではどこか 1 つの音名に 2 つの音が入り、そこだけ広くなります。半音階（リゲティ・フェルドマン・一柳・ケージ）では段が半音ごとになり、線の間隔は実際の半音の数（短 3 度なら 3、長 3 度なら 4）になります。5 音の音階（イーノ）では音のない音名があり、その線は音の高さから割り出して段と段の間に引きます。画面に入りきらない高さの音は、オクターブずらして 8va（1 オクターブ上）・8vb（1 オクターブ下）を添えて描きます。",
        en: "What if these composers wrote a piano sonata? Each composer has an independent three-movement sonata that borrows their methods, not their pieces. Each movement has its own few-minute arc and they play I → II → III in turn. Click while it plays to add a note at that height. The grand staff behind divides the screen into one row per note of the scale and draws each line on its line note's row (E, G, B, D, F and so on). So with scales that don't have seven notes, the staff lines aren't evenly spaced. There are only seven letter names, so an eight-note scale (Messiaen) puts two notes on one of them, and that gap is wider. With the chromatic scale (Ligeti, Feldman, Ichiyanagi, Cage) each row is a semitone, so the gaps follow the actual number of semitones (3 for a minor third, 4 for a major third). A five-note scale (Eno) leaves some letter names without a note, and their lines are drawn between rows, placed by pitch. Notes too high or low for the screen are drawn an octave in with 8va (an octave higher) or 8vb (an octave lower).",
      }),
    },
    "#composer": {
      title: { ja: "作曲家", en: "Composer" },
      text: {
        ja: "どの作曲家のソナタを鳴らすかです。押すと作曲家の一覧が開き、名前を押すとその作曲家の I から、楽章を押すとその楽章から鳴らします。作曲家は生まれた年の順に並んでいます。エリック・サティ: I. ゆるやかな舞曲（3 拍子で、左手が低い音と和音を揺り返す上に素朴な旋律が浮かび、同じ節がそのまま戻ってくる）、II. 小節線のない歌（左手が同じ形を刻み続け、右手は飾りの付いた短い節を決まりのない長さで繰り返し、ときどき両手とも立ち止まる）、III. 家具の音楽（聞き流されるための短いループを繰り返し、前触れなく別のループへ移り、最初のループに戻ってふいに終わる）。区切りごとに、左上に演奏の心得のような言葉が出ます（このページのために書いたもので、サティの書き込みではありません）。オリヴィエ・メシアン: I. 鳥の歌（鳥ごとに決まった鳴き方（連打・トリル・前打音つきのさえずり・駆け下り・跳ねる呼び声）があり、1 羽ずつ加わって鳴き交わし、やがて去っていく。低い所でときどき森のような和音が響く。上端の点が鳥）、II. リズムの登場人物（逆から読んでも同じになるリズムを 3 人が同時に繰り返し、1 人は真ん中の音が伸び、1 人は縮み、1 人は変わらない。しばらくごとに和音が短 3 度ずつずれていき、最後は元の高さに戻る。上端に 3 人のリズムが出る）、III. 音価と強さの旋法（鍵ごとに長さと強さと弾き方が決まっていて、高・中・低の 3 つの声が自分の音域の鍵を選び続けるだけで、リズムと強弱が生まれる。上端に鍵ごとの値が出る）。ジョン・ケージ（初めからプリペアド・ピアノで鳴ります）: I. 平方根の形（比の数の和を S として、S 小節の単位が S 回並び、単位の中の句も単位のまとまりも同じ比で分かれる。前半と後半をそれぞれ繰り返し、決めておいた十数個の響きだけを使う。上端に比と今の所が出る）、II. 偶然の表（音・長さ・強さの 8×8 の表から、易の卦を引くように偶然で選んで並べる。半分の升目は沈黙で、動く升目は使うと中身が替わる。区切りごとに速さと重なる声の数も偶然で決まる。左上に音の表と引いた卦が出る）、III. 時間の枠（「この間に始め、この間に終える」という枠だけを決め、どこで始めて終えるかは偶然にまかせる。2 人の奏者が静かに、長い沈黙を挟んで弾く。上端に枠と実際に鳴らした間が出る）。コンロン・ナンカロウ: I. 加速と減速（高い声部は速くなり続け、低い声部は遅くなり続けて、中ほどで速さが入れ替わる）、II. ブギウギの層（左手のブギウギに、3:2・5:4・7:4 の速さの右手の型が重なっては抜ける）、III. 収束するカノン（同じ旋律を 4 つの声部が違う速さで弾き、遅い声部から始めて、最後の音で全員がそろう）。ジェルジ・リゲティ: I. 一音から（1 つの音名だけで始め、区切りごとに音名を 1 つずつ加えながら速くなり、取っておいた最後の音名で終わる。上端の枠が使える音名）、II. 止まっていくメトロノーム（たくさんのメトロノームがそれぞれの速さで一斉に刻み始め、止まったものから抜けて、最後の 1 つが残る。クリックで 1 つ加わる）、III. 無秩序（右手は白鍵、左手は黒鍵だけで休まず刻み、強い音で旋律を浮かべる。右手がときどき 1 拍縮んで左手とずれていき、両手とも登りつめて突然終わる）。モートン・フェルドマン（どれもごく弱い音で鳴ります）: I. 不揃いな反復（長さの違う短い型を少しずつ変えながら数回ずつ繰り返し、前の型がときどき戻り、最後は最初の型に帰る）、II. 和音の陰影（広く散らばった柔らかい和音を長く置き、繰り返すたびに 1 音だけ半音ずらす。和音はだんだん薄くなる）、III. 記憶の層（左手が近い音どうしの小さな型を刻み続け、その上に右手の型が長さを違えて現れては消える）。一柳慧: I. 反復のずれ（両手の長さの違う長い型がずれていき、頭がそろうと両手のユニゾンで 1 周して強く終わる）、II. 間（偶然で決めた音と長い沈黙）、III. トッカータ（1 音ずつ伸びる速い旋律が、広がりながら加速する）。テリー・ライリー: I. 歩みの違う奏者（短い型を並べた譜面を 4 人の奏者がそれぞれの歩みで繰り返しながら進み、高い主音のパルスが刻み続ける。上端の点が各奏者の位置）、II. 純正の響き（純正律に調律し直したピアノで、ゆっくりした分散和音が 1 音ずつ伸びては縮む。右端に鳴っている音の比が出る）、III. 持続音と旋法（低い持続音の上で、速い型が音を足したり移したりしながら繰り返され、熱を帯びて駆け上がって終わる）。アルヴォ・ペルト: I. ティンティナブリ（旋律に主和音の音が規則で付き、中心の音へ向かう句が上下から交互に伸び縮みする）、II. 鐘とカノン（同じ下行の句を 3 つの声部が 1・2・4 倍の遅さで重ね、鐘が鳴り、最後は主音に着いて止まる）、III. 鏡（2 つの旋律が中心から鏡のように開いては閉じ、左手が主和音を分散して刻む）。スティーヴ・ライヒ: I. フェイズ（両手が同じ型を弾き、片方が 1 音ずつ前へずれて、12 回でまたそろう。3 回ずれるごとに和音が移る）、II. 脈動する和音（刻み続ける和音が息の長さでふくらんで消え、少しずつ移って最初の和音に帰る）、III. 積み上げ（休符を 1 つずつ音に置き換え、ずらした位置で別の手も同じ型を積み、最後は休符に戻す）。フィリップ・グラス: I. 足し算と引き算（短い音型を 1 音ずつ足しながら 4 回ずつ繰り返し、全部そろったら 1 音ずつ減らす。音型が替わるたびに左手の和音も移る。上端に音型と回数が出る）、II. 揺り返す和音（左手が 2 つの和音を分散和音で揺り返し、右手は長い音の旋律を同じ形で 2 回弾く。区切りは A B A C と並び、A が何度も戻ってくる）、III. 3 対 2（右手の 3 つずつと左手の 2 つずつの速い分散和音を重ねて、4 つの和音の巡りを回す。区切りごとに右手の型が広がって強くなり、突然止まる）。ブライアン・イーノ: I. 長さの違うループ（短い句を長さの違うループに載せて重ね、増えてから減っていく）、II. こだま（置いた音が一定の間で繰り返されながら小さくなり、重なって和音になる）、III. 規則から生まれる旋律（隣の音へ動きやすい、ときどき休む、という規則だけで旋律が生まれ、低い音が支える）。",
        en: "Whose sonata to play. Press it to open the list of composers; press a name to play from movement I, or a movement to play from there. Composers are listed by year of birth. Erik Satie: I. Slow dance (in three, a plain melody floats over a left hand rocking between bass notes and chords, and the same phrases come back unchanged), II. Song without bar lines (the left hand keeps the same figure while the right hand repeats short ornamented phrases of no fixed length, and both hands pause now and then), III. Furniture music (short loops meant to be ignored repeat and switch without warning, returning to the first loop before stopping abruptly). At each section, a whimsical playing direction appears at the top left (written for this page, not Satie's own). Olivier Messiaen: I. Birdsong (each bird has its own call, such as repeated notes, a trill, a chirp with grace notes, a falling run or a leaping call; they join one by one, answer each other and leave, while soft forest chords sound low now and then; the dots at the top are the birds), II. Rhythmic characters (three characters repeat rhythms that read the same backwards; one keeps growing in the middle, one shrinks and one stays the same, and every so often the chords move up a minor third, coming back down to where they began by the end; their rhythms show at the top), III. Mode of durations and intensities (every key has its own fixed length, loudness and touch, so rhythm and dynamics come only from which keys three voices in low, middle and high registers choose; the values per key show at the top). John Cage (prepared piano from the start): I. Square-root form (with S the sum of a ratio, units of S bars come S times, and both the phrases within a unit and the groups of units follow the same ratio; each half is repeated, using only a dozen fixed sounds; the ratio and the current place show at the top), II. Charts of chance (sounds, durations and dynamics are picked by chance from 8×8 charts, like casting I Ching hexagrams; half the sound cells are silence, and mobile cells change once used; each section's speed and number of voices are also left to chance; the sound chart and the last hexagram show at the top left), III. Time brackets (each sound only gets a window to start in and a window to end in, and chance decides where; two players play quietly with long silences; the brackets and what was actually played show at the top). Conlon Nancarrow: I. Acceleration and deceleration (the high voice keeps speeding up while the low voice keeps slowing down, trading speeds midway), II. Boogie-woogie layers (right-hand riffs at 3:2, 5:4 and 7:4 of the boogie-woogie bass pile up and drop out), III. Converging canon (four voices play the same melody at different speeds, the slowest starting first, all meeting on the last note). György Ligeti: I. From a single note (it starts with one pitch class and adds one per section while speeding up, saving the last for the final note; the boxes at the top show the pitch classes in use), II. Metronomes winding down (many metronomes start ticking at their own speeds and drop out as they run down until one is left; click to add one), III. Disorder (the right hand on white keys and the left on black keys play nonstop with accented melodies; the right hand now and then drops a beat and drifts ahead, and both climb until it stops abruptly). Morton Feldman (everything is very quiet): I. Irregular repetitions (short patterns of uneven lengths repeat a few times with small changes, earlier patterns return now and then, and the first comes back at the end), II. Shaded chords (soft, widely spaced chords are held and repeated with one note moved by a semitone each time, thinning out as it goes), III. Layers of memory (the left hand keeps up a small figure of close notes while right-hand patterns of other lengths come and go above). Toshi Ichiyanagi: I. Shifting repetitions (two hands' long patterns of different lengths drift apart; when their starts meet, both hands play one round in unison and end loudly), II. Ma (chance notes and long silences), III. Toccata (a fast line grows one note at a time, widening and speeding up). Terry Riley: I. Players at their own pace (four players work through a score of short modules, each repeating at their own pace over a steady high pulse; the dots at the top show where each player is), II. Just intonation (on a piano retuned to whole-number ratios, slow arpeggios grow and shrink a note at a time; the ratios of the sounding notes appear at the right), III. Drone and mode (over a low drone, fast patterns repeat while notes are added and moved, heating up into a final upward run). Arvo Pärt: I. Tintinnabuli (triad notes follow the melody by rule; phrases toward a central note grow and shrink from above and below), II. Bells and canon (three voices play the same falling phrase at 1, 2 and 4 times slower among bells, stopping as they reach the root), III. Mirror (two lines open and close around a central note like a mirror over a broken-chord left hand). Steve Reich: I. Phase (both hands play the same pattern; one creeps ahead a note at a time until they meet again after 12 shifts, and the chord moves every 3 shifts), II. Pulsing chords (repeated chords swell and fade over a breath, moving step by step back to the first chord), III. Build-up (rests become notes one at a time, other hands build the same pattern at an offset, then it thins back to rests). Philip Glass: I. Addition and subtraction (a short figure grows a note at a time, each length repeated four times, then shrinks a note at a time, with the left-hand chord moving for each new figure; the figure and the repeat count show at the top), II. Rocking chords (the left hand rocks between two chords in broken chords while the right hand plays a melody of long notes twice; sections go A B A C, with A coming back again and again), III. Three against two (fast broken chords in threes in the right hand and twos in the left go round a cycle of four chords; each section widens the right-hand pattern and gets louder, until it stops abruptly). Brian Eno: I. Loops of different lengths (short phrases on loops of different lengths pile up, then thin out), II. Echoes (each note repeats at a fixed interval, fading, and the echoes overlap into chords), III. Melody from rules (simple rules such as moving to a neighbouring note or resting now and then make the melody, over slow low notes).",
      },
    },
    // Sonata では音階と主音を作曲家にまかせるので、変化でも転調しない
    "#drift": {
      title: { ja: "変化", en: "Drift" },
      text: {
        ja: "オンにすると、音域・密度・音色の明るさ・響きが何分もかけてゆっくり揺れます。Sonata の音階と主音は作曲家ごとに決まっているので、転調はしません。",
        en: "When on, register, density, brightness and reverb sway slowly over many minutes. Sonata's scale and root are set by each composer, so the key doesn't change.",
      },
    },
    "#sway": {
      title: { ja: "揺らぎ", en: "Sway" },
      text: {
        ja: "人が弾くような時間の揺らぎの量です。ずれがゆっくり前のめりになったりもたったりし、右手と左手が少し食い違い、和音は低い音から軽く崩れ、強い音はわずかに早く鳴ります。1 で揺らぎなし（機械のように正確）、3 が標準、5 で 2 倍になります。",
        en: "How much human timing sway to add. The timing slowly pushes and drags, the hands drift slightly apart, chords roll up from the bass and loud notes land a touch early. 1 is none (machine-exact), 3 is the default and 5 is double.",
      },
    },
    "#tuning": {
      title: { ja: "調律", en: "Tuning" },
      text: {
        ja: "ピアノの調律の具合です。ぴったり: 平均律のとおり。少しずれ: 鍵ごとに少しずつ音程が外れます（同じ鍵はいつも同じずれ）。古いピアノ: ずれが大きくなり、1 つの鍵の弦どうしもそろわず、うなりのある酒場のピアノのような響きになります。作曲家を選ぶと、その作曲家の初めの値になります（コンロン・ナンカロウは古いピアノ、ほかはぴったり）。変えた値は、ページを開いているあいだ作曲家ごとに覚えています。",
        en: "How well the piano is tuned. In tune: exact equal temperament. Slightly off: each key is a little out, always by the same amount. Old piano: keys are further out and the strings of each key disagree, giving a beating, honky-tonk sound. Choosing a composer resets it to their default (old piano for Conlon Nancarrow, in tune for the others); changes are remembered per composer while the page is open.",
      },
    },
    "#prepared": {
      title: { ja: "プリペアド・ピアノ", en: "Prepared piano" },
      text: {
        ja: "弦のあいだにボルトやゴムやねじを挟んだように、鍵ごとに音色を変えます。ボルトの鍵は短く金属的に、ゴムの鍵は鈍く短く、ねじの鍵はうなりのある鐘のように鳴り、何も挟まない鍵もあります。どの鍵に何を挟むかは決まっていて、同じ鍵はいつも同じ音色です。作曲家を選ぶと、その作曲家の初めの値になります（ジョン・ケージは入、ほかは切）。変えた値は、ページを開いているあいだ作曲家ごとに覚えています。",
        en: "Changes the sound key by key, as if bolts, rubber or screws were placed between the strings. Bolted keys ring short and metallic, rubber keys sound dull and short, screwed keys ring like beating bells, and some keys are left alone. Which key gets what is fixed, so a key always sounds the same. Choosing a composer resets it to their default (on for John Cage, off for the others); changes are remembered per composer while the page is open.",
      },
    },
    "#movement": {
      title: { ja: "楽章", en: "Movement" },
      text: {
        ja: "今の楽章です。選ぶと、その楽章の始めから鳴らします。そこから先の楽章も続けて鳴ります。",
        en: "The current movement. Choosing one plays it from the start, and the following movements continue after it.",
      },
    },
    // 評価は開発サーバーでだけ使える（公開版にはボタンがない）
    '[data-section="performance"] h2': import.meta.env.DEV ? {
      title: { ja: "演奏と評価", en: "Performance and ratings" },
      text: {
        ja: "楽章を鳴らしている間（と次の楽章が始まるまで）、左下に「良い・普通・ダメ」のボタンが出ます（キーの 1・2・3 でも押せます）。押すと、その楽章の評価を、Op.・設定・天気・その日に何楽章目か・直前の楽章と、鳴った音から計算した特徴量（音域の幅、跳躍や繰り返しの割合、主音で終わったかなど）と一緒に記録します。押し直すと評価を置き換えます。記録はこのブラウザの中だけに残り、JSON や CSV で書き出して傾向を調べられます。",
        en: "While a movement plays (and until the next one starts), Good / OK / Bad buttons appear at the bottom left (or press 1, 2, 3). Rating saves it with the Op., settings, weather, how many movements you'd heard that day, the previous movement, and features computed from the notes played (range, share of leaps and repeats, whether it ended on the root and so on). Rating again replaces it. Ratings stay in this browser only; export them as JSON or CSV to look for trends.",
      },
    } : {
      title: { ja: "演奏", en: "Performance" },
      text: {
        ja: "演奏ごとの作品番号（Op.）の設定です。",
        en: "Settings for each performance's opus number (Op.).",
      },
    },
    "#seed": {
      title: { ja: "作品番号（Op.）", en: "Opus number (Op.)" },
      text: {
        ja: "演奏ごとの番号です。演奏の材料（型・旋律・和音の順番など）は、この番号から決まります。空のときは、I から始めるたびに新しい番号になります。今の演奏の番号は、画面の右下に「Op.」として出ます。良かった演奏の番号を入れると（「今の演奏の Op. を使う」でも入ります）、同じ演奏をもう一度聴けます。ただし天気・変化・音域・密度・テンポが違うと、同じ番号でも違う演奏になります。番号は URL にも残ります。",
        en: "Each performance's number. The material of a performance (patterns, melodies, the order of chords and so on) comes from this number. When empty, a new number is used each time the sonata starts from movement I. The current performance's number is shown at the bottom right as \"Op.\". Enter the number of a performance you liked (or press \"Use this performance's Op.\") to hear the same performance again. Weather, Drift, register, density and tempo still change it. The number is kept in the URL.",
      },
    },
    "#play": {
      title: { ja: "再生", en: "Play" },
      text: {
        ja: "選んでいる楽章から鳴らします。ソナタが終わったあとは I から鳴らします。画面をクリックしても同じです。",
        en: "Plays from the selected movement, or from movement I once the sonata has finished. Clicking the screen does the same.",
      },
    },
    "#stop": {
      title: { ja: "停止", en: "Stop" },
      text: import.meta.env.DEV ? {
        ja: "演奏を止めます。止めたあとも、その楽章を評価できます。",
        en: "Stops playing. You can still rate the movement afterwards.",
      } : { ja: "演奏を止めます。", en: "Stops playing." },
    },
    "#repeat": {
      title: { ja: "ずっと再生", en: "Keep playing" },
      text: {
        ja: "入れると、ソナタが終わっても止まらず、次の作曲家のソナタへ順に移り続けます。もう一度押すと切れます。止まっているときに入れると、すぐ鳴り始めます。",
        en: "When on, playback doesn't stop after a sonata but moves on to the next composer's sonata in order. Press again to turn it off. Turning it on while stopped starts playing.",
      },
    },
    "#shuffle": {
      title: { ja: "シャッフル再生", en: "Shuffle" },
      text: {
        ja: "入れると、作曲家を混ぜた順で、ソナタを止まらずに鳴らし続けます。全員を 1 回ずつ鳴らしてから、また混ぜ直します。もう一度押すと切れます。止まっているときに入れると、最初の作曲家の I から鳴り始めます。",
        en: "When on, sonatas keep playing with the composers in shuffled order; everyone plays once before it shuffles again. Press again to turn it off. Turning it on while stopped starts the first composer's movement I.",
      },
    },
    "#restart": {
      title: { ja: "最初から", en: "From the top" },
      text: { ja: "ソナタを I 楽章の始めから鳴らし直します。", en: "Plays the sonata again from the start of movement I." },
    },
    '[data-section="repeat"] h2': {
      title: { ja: "反復", en: "Repetition" },
      text: {
        ja: "速い楽章の刻みの設定です。",
        en: "Settings for the pulse of the fast movements.",
      },
    },
    "#tempo": {
      title: { ja: "テンポ", en: "Tempo" },
      text: {
        ja: "4 分音符の速さです。一柳慧の I と III、ライヒの I は 16 分音符、ライヒの II と III は 8 分音符で刻みます。イーノの楽章は刻みを持たないので、テンポは効きません。ペルトでは 1 音の長さが決まります（I は 2 拍、II は 1 拍から 4 拍、III は 8 分音符の刻みと 2 拍の旋律）。ナンカロウでは、I は駆ける速さ、II は左手の 8 分音符、III は旋律の音の数が決まります（III の途中で変えても効きません）。フェルドマンでは、1 拍の長さ（型や和音の間合い）が決まります。ライリーでは、I のパルス（8 分音符）、II の分散和音の速さ、III の 16 分音符が決まります。リゲティでは、I の始めの速さ、II のメトロノームの速さ（始めるとき）、III の 16 分音符が決まります。サティでは、どの楽章も 1 拍の長さが決まります。ケージでは、I の拍と、II の基準の速さ（区切りごとに偶然で速くも遅くもなる）が決まります。III は時間の枠で動くので、テンポは効きません。メシアンでは、II と III の 16 分音符が決まります（I の鳥は、テンポにかかわらず自分の速さで鳴きます）。グラスでは、I の 8 分音符、II の 4 分音符、III の拍（右手は 3 連符、左手は 8 分音符で刻む）が決まります。天気を使うと、気温でさらに速くなったり遅くなったりします。",
        en: "Quarter-note tempo. Ichiyanagi I and III and Reich I move in sixteenths, Reich II and III in eighths. Eno's movements have no pulse, so tempo doesn't affect them. In Pärt it sets the note lengths (two beats in I, one to four beats in II, eighths and half notes in III). In Nancarrow it sets how fast the runs go in I, the bass eighths in II, and how many notes the melody has in III (changing it mid-movement has no effect there). In Feldman it sets the beat that the patterns and chords are spaced by. In Riley it sets the eighth-note pulse in I, the arpeggio speed in II and the sixteenths in III. In Ligeti it sets the starting speed in I, the metronome speeds in II (when it starts) and the sixteenths in III. In Satie it sets the beat in every movement. In Cage it sets the beat in I and the base speed in II (each section is faster or slower by chance); III runs on time brackets, so tempo doesn't affect it. In Messiaen it sets the sixteenths in II and III (the birds in I sing at their own speed). In Glass it sets the eighths in I, the quarters in II and the beat in III (triplets in the right hand, eighths in the left). With weather on, temperature makes it faster or slower.",
      },
    },
  },
  loops: {
    [PAGE_GUIDE]: {
      title: { ja: "Loops の遊び方", en: "How to play Loops" },
      text: withBarNote({
        ja: "クリックした場所にテープループを置きます。縦の位置で音の高さ、横の位置でループの長さ（15〜35 秒）が決まります。長さの違うループが重なるので、同じ響きはほとんど二度と来ません（ブライアン・イーノ『Music for Airports』の手法）。ループの中心をクリックすると外せます。",
        en: "Click to place a tape loop. Height sets the pitch and horizontal position the loop length (15–35 s). Loops of different lengths overlap, so the same harmony almost never returns (the technique of Brian Eno's Music for Airports). Click a loop's center to remove it.",
      }),
    },
    "#density": {
      title: { ja: "密度", en: "Density" },
      text: {
        ja: "自動で音が置かれる頻度です。1 でまばらに、5 で多くなります。Loops では、自動で置くループの上限本数（4〜10 本）も変わります。",
        en: "How often sounds are placed automatically. 1 is sparse, 5 is busy. In Loops it also sets how many loops can be placed automatically (4–10).",
      },
    },
    "#record": {
      title: { ja: "録音", en: "Record" },
      text: {
        ja: "押してからクリックで演奏し、「停止」を押すと、そのフレーズが録音した長さのループになります。最短 4 秒で、40 秒か 16 音に達すると自動で止まります。",
        en: "Press it, play by clicking, then press “Stop” to turn the phrase into a loop of the recorded length. Loops are at least 4 s, and recording stops automatically at 40 s or 16 notes.",
      },
    },
    "#auto": {
      title: { ja: "自動", en: "Auto" },
      text: {
        ja: "オンにすると、しばらく操作がないときに 1 音のループがひとりでに置かれます。",
        en: "When on, single-note loops are placed by themselves after a while without interaction.",
      },
    },
    "#clear": {
      title: { ja: "クリア", en: "Clear" },
      text: { ja: "置いてあるループをすべて消します。", en: "Removes all loops." },
    },
  },
  tape: {
    [PAGE_GUIDE]: {
      title: { ja: "Tape の遊び方", en: "How to play Tape" },
      text: withBarNote({
        ja: "1 本のテープで遊ぶ楽器です。クリックで音を弾き、押したままにすると伸び、ドラッグするとなぞった高さの音を順に弾きます。弾いた音は右の録音ヘッドでテープに録られ、左の再生ヘッドで鳴ると、また録音ヘッドへ戻されて録り重ねられます。戻るたびに少し小さく、こもっていくので、古い層ほど遠くに聞こえます（ブライアン・イーノ『Discreet Music』や、ロバート・フリップとイーノが 2 台のテープレコーダーで作った仕組み）。録音ヘッドの右の操作盤で、残り方と 1 周の長さを変え、ソロ・ホールド・フェード・マイクを使えます。「オクターブ」（O）は、押すたびに上・下・なしと切り替わり、戻るたびに 1 オクターブずつ上がり（下がり）続けます。「逆再生」（R）は、1 周ごとにテープを裏返して鳴らします。戻ってくる音は終わりから鳴り、次の周はまた順向きに戻るので、順と逆が交互に重なっていきます。止めると、今の 1 周が終わったところで元に戻ります。「ラジオ」（T）は、世界のインターネットラジオをテープに録ります。",
        en: "An instrument made of one tape loop. Click to play a note, hold to let it ring, or drag to play the notes you pass over. What you play is recorded at the rec head on the right, sounds at the play head on the left, and is fed back to the rec head to be recorded again. Each time round it gets a little quieter and darker, so older layers sound farther away (the setup of Brian Eno's Discreet Music and of Robert Fripp and Eno's two tape recorders). Use the panel right of the rec head for feedback, loop length, Solo, Hold, Fade and Mic. Octave (O) cycles through up, down and off; each time round the repeats move another octave. Reverse (R) flips the tape every turn: what comes back plays from its end, and the next turn flips it forward again, so forward and backward layers build up in turn. When you switch it off, it finishes the current turn first. Radio (T) records internet radio from around the world onto the tape.",
      }),
    },
    '[data-section="tape-voice"] h2': {
      title: { ja: "テープの音", en: "Tape voice" },
      text: {
        ja: "テープに録る音の設定です。ソロのとき以外は、この音で鳴ります。自動もこの音で弾きます。",
        en: "Settings for the sound recorded onto the tape. It's what plays except during Solo, and what Auto plays.",
      },
    },
    '[data-section="solo-voice"] h2': {
      title: { ja: "ソロの音", en: "Solo voice" },
      text: {
        ja: "ソロ（操作盤のソロか Shift）のときに鳴る音の設定です。テープの音の土台に、別の音色を重ねたり、その上で即興したりできます。画面の音名も、ソロの間はこちらの音域に変わります。",
        en: "Settings for the sound you play during Solo (the Solo button or Shift): a second voice to layer over the tape voice, or to improvise with over it. During Solo the note names on screen follow this register.",
      },
    },
    "#solo-record": {
      title: { ja: "ソロの音もテープに録る", en: "Record the solo voice too" },
      text: {
        ja: "オンにすると、ソロで弾いた音（とマイク）もテープに録られ、テープの上に紫の線で流れます。オフにすると、ソロの間は録らずに聞かせるだけになり、テープの土台の上で即興できます（フリップがループの上でギターを弾いたように）。",
        en: "When on, what you play during Solo (and the mic) is recorded too, shown on the tape in purple. When off, nothing is recorded during Solo, so you can improvise over the tape's bed, as Fripp played guitar over his loops.",
      },
    },
    "#tape-timbre": {
      title: { ja: "音色", en: "Timbre" },
      text: {
        ja: "テープの音の音色です。チェロは弓で弾くように立ち上がり、少し遅れてビブラートがかかる、伸ばす音です（合成した音）。チェロ＋コントラバスは、そのオクターブ下でコントラバスが一緒に弾きます。ストリングスは、同じ高さを 3 人、オクターブ下を 2 人で、少しずつずれながらゆっくり弾く合奏で、輪郭のぼやけた霧のような響きです。メロトロンは、鍵盤ごとの録音テープを再生する楽器を模した、バイオリンの音です。帯域が狭く、テープの回転の揺れと小さなノイズがあります。クリーンは倍音の多いシンセの音、ドライブは歪ませてギターアンプのように高音を丸めた、長く伸びる音です。",
        en: "The tape voice's timbre. Cello swells like a bowed string and gains vibrato after a moment (a synthesized cello). Cello + double bass adds a double bass an octave below. Strings is a slow-swelling section, three players at pitch and two an octave below, each slightly out of step, for a misty, blurred bed. Mellotron imitates the instrument that plays a strip of recorded tape for each key, here violins: narrow in range, with the tape's wavering pitch and a little hiss. Clean is a synth tone rich in overtones; Drive distorts it, rounds off the highs like a guitar amp and lets it ring longer.",
      },
    },
    "#solo-timbre": {
      title: { ja: "音色", en: "Timbre" },
      text: {
        ja: "ソロの音の音色です。選べる音はテープの音と同じです。",
        en: "The solo voice's timbre. The choices are the same as for the tape voice.",
      },
    },
    "#solo-register": {
      title: { ja: "音域", en: "Register" },
      text: {
        ja: "ソロの音で、画面に割り当てる音の高さの範囲です。1 で 1 オクターブ低く、5 で 1 オクターブ高くなります。",
        en: "The pitch range mapped to the screen for the solo voice. 1 is an octave lower, 5 an octave higher.",
      },
    },
    "#tape-volume": {
      title: { ja: "大きさ", en: "Volume" },
      text: { ja: "テープの音の大きさです。80% が元の大きさです。", en: "The tape voice's volume. 80% is the original level." },
    },
    "#solo-volume": {
      title: { ja: "大きさ", en: "Volume" },
      text: { ja: "ソロの音の大きさです。80% が元の大きさです。", en: "The solo voice's volume. 80% is the original level." },
    },
    "#tape-drag": {
      title: { ja: "ドラッグ", en: "Drag" },
      text: {
        ja: "ドラッグしたときの弾き方です。「音階で弾く」は、なぞった高さのスケールの音を順に弾きます。「なめらかにつなぐ」は、1 つの音を伸ばしたまま、指の動きに合わせて音程を連続して動かします（スライドギターのように）。指を止めると、近くのスケールの音へ寄っていきます。",
        en: "How dragging plays. “Play scale notes” plays the scale notes you pass over one by one. “Glide” keeps one note ringing and bends its pitch smoothly with your finger, like a slide guitar; when you stop, it settles onto the nearest scale note.",
      },
    },
    "#solo-drag": {
      title: { ja: "ドラッグ", en: "Drag" },
      text: {
        ja: "ソロの音で、ドラッグしたときの弾き方です。選べる弾き方はテープの音と同じです。",
        en: "How dragging plays the solo voice. The choices are the same as for the tape voice.",
      },
    },
    "#density": {
      title: { ja: "密度", en: "Density" },
      text: {
        ja: "自動で弾く頻度です。1 でまばらに、5 で多くなります。自分で弾く分には影響しません。",
        en: "How often notes are played automatically. 1 is sparse, 5 is busy. It doesn't affect what you play yourself.",
      },
    },
    '[data-section="tape"] h2': {
      title: { ja: "テープ", en: "Tape" },
      text: {
        ja: "テープの長さと、音の残り方・歪み方の設定です。",
        en: "Settings for the tape's length and how sounds last and distort on it.",
      },
    },
    "#tape-length": {
      title: { ja: "1 周の長さ", en: "Loop length" },
      text: {
        ja: "テープ 1 周の長さ（3〜90 秒）で、弾いた音が戻ってくるまでの時間です。演奏中に動かすと、ヘッドを動かしたときのように、録ってある音の音程がうねります。長くすると下がり、短くすると上がり、速く動かすほど大きくうねります。目盛りは短いほうが細かく、左半分でおよそ 16 秒までです。操作盤の「長さ」のフェーダーと同じです。",
        en: "The length of one turn of the tape (3–90 s): how long a note takes to come back. Moving it while playing warps the pitch of what's on the tape, as if moving a head: lower as it lengthens, higher as it shortens, and more the faster you move it. The scale is finer at the short end: the left half covers up to about 16 s. Same as the Length fader on the panel.",
      },
    },
    "#tape-feedback": {
      title: { ja: "残り方", en: "Feedback" },
      text: {
        ja: "1 周ごとに、どれだけの大きさで録り直すかです。0% だと 1 回だけ戻ってきて消え、高いほど長く積もります。98% 近くでは層が重なり続け、歪みながらノイズのように育ちます。操作盤のフェーダーと同じです。ホールドやフェードの間に動かすと、それを解いて手の値になります。",
        en: "How much is recorded again each time round. At 0% a note comes back once and is gone; higher values let layers pile up longer. Near 98% they keep stacking and grow into a distorted, noisy wash. Same as the fader on the panel. Moving it during Hold or Fade ends them and takes your value.",
      },
    },
    "#tape-saturation": {
      title: { ja: "歪み", en: "Saturation" },
      text: {
        ja: "録り直すときの飽和の強さです。小さい音の残り方は変わらず、層が厚くなるほど早く、強く歪みます。0% でも、重ねすぎると少し歪みます。",
        en: "How hard the tape saturates when recording again. Quiet sounds last the same; the thicker the layers, the sooner and harder they distort. Even at 0% heavy stacking distorts a little.",
      },
    },
    "#tape-wear": {
      title: { ja: "傷み", en: "Wear" },
      text: {
        ja: "回るたびにテープが少しずつ傷む度合いです。上げるほど、録り直すたびに音がこもり、回転の揺れで音程がわずかに揺らぎ、ザーというノイズが混ざります。どれも 1 周ごとに重なるので、古い層ほど遠く、ぼやけて聞こえます。ノイズはテープに載っている音の大きさに合わせて入るので、テープが空になると消えます。ホールド中は傷みません。",
        en: "How much the tape wears each time round. The higher it is, the darker each repeat gets, the more the pitch wavers with the tape's speed, and the more hiss creeps in. All of it builds up turn by turn, so older layers sound more distant and blurred. The hiss follows the level of what's on the tape, so it disappears when the tape is empty. Nothing wears during Hold.",
      },
    },
    "#extra-heads": {
      title: { ja: "足す再生ヘッド", en: "Extra play heads" },
      text: {
        ja: "テープの途中に置く再生ヘッドの数（0〜3）です。録った音が、元の再生ヘッドに着く前にも、ずれて何度か聞こえます。足したヘッドは聞こえるだけで、テープへは戻しません。帯の下のつまみを左右にドラッグすると位置を変えられ、動かしている間はそのヘッドの音の音程がうねります。",
        en: "How many play heads sit partway along the tape (0–3). A recorded note is heard again, offset, before it reaches the main play head. Extra heads only play; they don't feed back onto the tape. Drag a head's handle at the bottom of the band to move it; its pitch warps while it moves.",
      },
    },
    "#mellotron-limit": {
      title: { ja: "メロトロンは 8 秒で止まる", en: "Mellotron stops after 8 s" },
      text: {
        ja: "本物のメロトロンは、鍵盤ごとのテープが約 8 秒で終わるので、押し続けても 8 秒で音が消えます。オンでは同じように 8 秒で止まり、オフでは押している間ずっと鳴ります。音色がメロトロンのテープの音とソロの音の両方に効きます。",
        en: "A real Mellotron's tape for each key runs out after about 8 seconds, so a held note dies away. When on, notes stop after 8 seconds the same way; when off, they sound for as long as you hold them. Applies to both the tape and solo voices when set to Mellotron.",
      },
    },
    "#tape-low-cut": {
      title: { ja: "低音を削る", en: "Low cut" },
      text: {
        ja: "録り直すたびに、この高さより下の音を削ります。低音がたまって濁らないようにするためです。下げると、コントラバスなどの低い音も繰り返し残りますが、重ねるほど低音が膨らみやすくなります。",
        en: "Each time round, sounds below this pitch are trimmed so the low end doesn't build up into mud. Lower it to keep low notes such as the double bass on later repeats, at the cost of a heavier low end as layers pile up.",
      },
    },
    "#fade-length": {
      title: { ja: "フェードの長さ", en: "Fade length" },
      text: {
        ja: "フェードを押してから、残り方が 0% になるまでの時間（5〜300 秒）です。初めはゆっくり、最後は速く消えていきます。",
        en: "How long Fade takes to bring feedback down to 0% (5–300 s). The tape fades slowly at first and faster at the end.",
      },
    },
    "#auto": {
      title: { ja: "自動", en: "Auto" },
      text: {
        ja: "オンにすると、10 秒ほど弾かない（マイクにも音が入らない）ときに、ひとりでに音を弾きます。テープの薄いところが録音ヘッドに来たときに、今テープに残っている音の近くの音を弾くので、響きに寄り添いながら隙間が埋まっていきます。ソロ・ホールド・フェード中は弾きません。",
        en: "When on, notes play by themselves after about 10 seconds without you playing (or sound at the mic). They come when a thin stretch of tape reaches the rec head, near the notes already on the tape, so the gaps fill in with the harmony. Nothing plays during Solo, Hold or Fade.",
      },
    },
    '[data-section="mic"] h2': {
      title: { ja: "マイク", en: "Microphone" },
      text: {
        ja: "マイクで楽器や声をテープに録る設定です。操作盤の「マイク」か M キーで開け閉めします。マイクの音はスピーカーからは直接鳴らさず、テープにだけ録ります。ホールド・フェード中と、録らない設定のソロ中は録りません。",
        en: "Settings for recording an instrument or voice onto the tape. Open and close it with Mic on the panel or the M key. The mic is only recorded onto the tape, never sent straight to the speakers, and isn't recorded during Hold, Fade, or Solo when the solo voice isn't recorded.",
      },
    },
    "#mic-level": {
      title: { ja: "入力の大きさ", en: "Input level" },
      text: {
        ja: "マイクの音をテープに録る大きさです。部屋の雑音を積もらせないよう、とても小さい音は録りません。",
        en: "How loud the mic is recorded onto the tape. Very quiet sounds are left out so room noise doesn't pile up.",
      },
    },
    "#mic-echo-cancel": {
      title: { ja: "エコー除去", en: "Echo cancellation" },
      text: {
        ja: "スピーカーで聴くときはオンにすると、テープから鳴った音がまたマイクに入って積もり続けるのを抑えます。ヘッドホンで聴くならオフのほうが音がよくなります。",
        en: "With speakers, keep it on so the tape's sound doesn't go back into the mic and keep piling up. With headphones, turn it off for better sound.",
      },
    },
    '[data-section="radio"] h2': {
      title: { ja: "ラジオ", en: "Radio" },
      text: {
        ja: "世界のインターネットラジオを、テープに録る音として使います（ジョン・ケージ『Imaginary Landscape No. 4』や、イーノとバーン『My Life in the Bush of Ghosts』のように）。操作盤の「ラジオ」か T キーでオン・オフし、オンのときに N キーか「別の局へ」で局を変えます。局はランダムに選ばれ、探している間はダイヤルを回すような雑音が鳴ります。マイクと同じく、放送はスピーカーから直接は鳴らさず、テープにだけ録ります。局の一覧は radio-browser.info のものです。設定で、断片で録る、話の多い局を選ぶ、音楽ならほかの局へ、政治色の強い局を除く、宗教の局を除く、を選べます（はじめはどれもオン）。音楽を除いても、放送には権利があるので、録音を公開するときは気をつけてください。",
        en: "Use internet radio from around the world as material for the tape (in the spirit of John Cage's Imaginary Landscape No. 4 and Eno and Byrne's My Life in the Bush of Ghosts). Turn it on and off with Radio on the panel or the T key; while it's on, N or Another station changes station. Stations are picked at random, with dial-like noise while tuning. Like the mic, the broadcast is only recorded onto the tape, never sent straight to the speakers. Stations come from radio-browser.info. Settings let you record in fragments, prefer talk stations, skip music, skip political stations and skip religious stations (all on at first). Even without music, broadcasts have rights holders, so take care when sharing recordings.",
      },
    },
    "#radio-level": {
      title: { ja: "入力の大きさ", en: "Input level" },
      text: {
        ja: "ラジオの音をテープに録る大きさです。放送は途切れずに入り続けるので、残り方が高いとすぐ積もります。小さめから始めてください。",
        en: "How loud the radio is recorded onto the tape. A broadcast never stops, so with high feedback it piles up quickly; start low.",
      },
    },
    "#radio-fragments": {
      title: { ja: "断片で録る", en: "Record in fragments" },
      text: {
        ja: "放送を流し続けて録るのでなく、短い断片を、間を空けて録ります。1 局で 1〜3 個録ると、ほかの局へ移ります。断片はテープのあちこちに散らばり、局も変わっていくので、同じ並びは二度と現れません。オフにすると、放送をそのまま録り続けます。",
        en: "Instead of recording the broadcast continuously, record short fragments with gaps between them. After 1–3 fragments it moves to another station. The fragments end up scattered around the tape and the stations keep changing, so the same collage never comes back. Turn it off to record the broadcast continuously.",
      },
    },
    "#radio-fragment-length": {
      title: { ja: "断片の長さ", en: "Fragment length" },
      text: {
        ja: "1 つの断片のおよその長さです。毎回、この半分から 1.5 倍の間で決まります。",
        en: "The rough length of one fragment; each one is between half and 1.5 times this.",
      },
    },
    "#radio-fragment-gap": {
      title: { ja: "断片の間", en: "Gap between fragments" },
      text: {
        ja: "断片の後に空ける間を、録った断片の長さの何倍にするかです。毎回、この半分から 1.5 倍の間で決まります。長いと、静かな中に断片がときどき現れ、短いと断片が続いて層になります。0 にすると間を空けません（局を移るときの局探しの時間だけ空きます）。",
        en: "How long the gap after a fragment is, as a multiple of that fragment's length; each gap is between half and 1.5 times this. Long gaps let fragments appear now and then in the quiet; short ones run them together into a layer. At 0 there is no gap (except the time spent tuning to another station).",
      },
    },
    "#radio-speech": {
      title: { ja: "話の多い局を選ぶ", en: "Prefer talk stations" },
      text: {
        ja: "ニュースやトーク、朗読などの局（radio-browser.info で news・talk・spoken のタグが付いた局）から選びます。オフにすると、音楽の局も含めたすべての局から選びます。",
        en: "Pick from news, talk and spoken-word stations (those tagged news, talk or spoken on radio-browser.info). Turn it off to pick from all stations, music ones included.",
      },
    },
    "#radio-skip-music": {
      title: { ja: "音楽ならほかの局へ", en: "Skip music" },
      text: {
        ja: "放送が音楽になったら、録らずにすぐほかの局を探し、話し声だけを録ります。音の特徴（声の切れ目、音の高さの安定、一定の拍、低音の量）から見分けるため、放送は 4 秒遅れてテープに入り、局を変えた直後は話し声と分かるまで数秒待ちます。20 秒たっても話し声と分からない局も飛ばします。見分けは完全ではなく、ラップや BGM の上の話し声などで迷うことがあります。",
        en: "When a broadcast turns to music, it isn't recorded and another station is found right away, so only speech goes onto the tape. It tells them apart from the sound itself (pauses between words, steady pitches, a regular beat, the amount of bass), so the broadcast reaches the tape 4 seconds late, and after changing station it waits a few seconds until it hears speech. Stations still unclear after 20 seconds are skipped too. It isn't perfect: rap or talk over background music can confuse it.",
      },
    },
    "#radio-skip-politics": {
      title: { ja: "政治色の強い局を除く", en: "Skip political stations" },
      text: {
        ja: "局の名前やタグに、政治・プロパガンダ・保守・リベラル・政府などの言葉がある局を選びません。タグのない局は見分けられないので、すべてを除けるわけではありません。",
        en: "Skip stations whose name or tags mention politics, propaganda, conservative, liberal, government and the like. Stations without such tags can't be told apart, so some may still get through.",
      },
    },
    "#radio-skip-religion": {
      title: { ja: "宗教の局を除く", en: "Skip religious stations" },
      text: {
        ja: "局の名前やタグに、キリスト教・イスラム教・教会・ゴスペル・説教・聖書・礼拝などの言葉がある局を選びません。タグのない局は見分けられないので、すべてを除けるわけではありません。",
        en: "Skip stations whose name or tags mention Christianity, Islam, church, gospel, sermons, the Bible, worship and the like. Stations without such tags can't be told apart, so some may still get through.",
      },
    },
    "#radio-next": {
      title: { ja: "別の局へ", en: "Another station" },
      text: {
        ja: "ランダムに別の局へ変えます。ラジオがオフのときは、オンにして局を探します。",
        en: "Switch to another random station. If the radio is off, this turns it on.",
      },
    },
    "#weather": {
      title: { ja: "天気", en: "Weather" },
      text: {
        ja: "オンにすると、選んだ場所の今の天気で音が変わります。空模様でテープのこもり方（晴れは明るく、雨や雪はこもる）、雨で自動で弾く頻度、雲で響きの深さが決まります。15 分ごとに更新します。",
        en: "When on, the current weather at the chosen place shapes the sound: the sky sets how dark the tape gets (bright when clear, muffled in rain or snow), rain how often notes play automatically and clouds the reverb depth. Updates every 15 minutes.",
      },
    },
    "#clear": {
      title: { ja: "クリア", en: "Clear" },
      text: { ja: "テープに録ってある音をすべて消します。", en: "Erases everything on the tape." },
    },
  },
};
