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
        ja: "作曲家がピアノソナタを書いたら、という試みです。作曲家ごとに独立した 3 楽章のソナタで、曲そのものは引用せず、作り方だけを借りています。楽章はそれぞれ数分の流れ（始まり・盛り上がり・終わり）を持ち、I → II → III と続けて鳴ります。演奏中にクリックすると、その高さの音が音楽に加わります。",
        en: "What if these composers wrote a piano sonata? Each composer has an independent three-movement sonata that borrows their methods, not their pieces. Each movement has its own few-minute arc and they play I → II → III in turn. Click while it plays to add a note at that height.",
      }),
    },
    "#composer": {
      title: { ja: "作曲家", en: "Composer" },
      text: {
        ja: "どの作曲家のソナタを鳴らすかです。一柳慧: I. 反復のずれ（両手の長さの違う型がずれていき、頭がそろって終わる）、II. 間（偶然で決めた音と長い沈黙）、III. トッカータ（1 音ずつ伸びる速い旋律が、広がりながら加速する）。スティーヴ・ライヒ: I. フェイズ（両手が同じ型を弾き、片方が 1 音ずつ前へずれて、12 回でまたそろう。3 回ずれるごとに和音が移る）、II. 脈動する和音（刻み続ける和音が息の長さでふくらんで消え、少しずつ移って最初の和音に帰る）、III. 積み上げ（休符を 1 つずつ音に置き換え、ずらした位置で別の手も同じ型を積み、最後は休符に戻す）。ブライアン・イーノ: I. 長さの違うループ（短い句を長さの違うループに載せて重ね、増えてから減っていく）、II. こだま（置いた音が一定の間で繰り返されながら小さくなり、重なって和音になる）、III. 規則から生まれる旋律（隣の音へ動きやすい、ときどき休む、という規則だけで旋律が生まれ、低い音が支える）。アルヴォ・ペルト: I. ティンティナブリ（旋律に主和音の音が規則で付き、中心の音へ向かう句が上下から交互に伸び縮みする）、II. 鐘とカノン（同じ下行の句を 3 つの声部が 1・2・4 倍の遅さで重ね、鐘が鳴り、最後は主音に着いて止まる）、III. 鏡（2 つの旋律が中心から鏡のように開いては閉じ、左手が主和音を分散して刻む）。コンロン・ナンカロウ: I. 加速と減速（高い声部は速くなり続け、低い声部は遅くなり続けて、中ほどで速さが入れ替わる）、II. ブギウギの層（左手のブギウギに、3:2・5:4・7:4 の速さの右手の型が重なっては抜ける）、III. 収束するカノン（同じ旋律を 4 つの声部が違う速さで弾き、遅い声部から始めて、最後の音で全員がそろう）。モートン・フェルドマン（どれもごく弱い音で鳴ります）: I. 不揃いな反復（長さの違う短い型を少しずつ変えながら数回ずつ繰り返し、前の型がときどき戻り、最後は最初の型に帰る）、II. 和音の陰影（広く散らばった柔らかい和音を長く置き、繰り返すたびに 1 音だけ半音ずらす。和音はだんだん薄くなる）、III. 記憶の層（左手が近い音どうしの小さな型を刻み続け、その上に右手の型が長さを違えて現れては消える）。テリー・ライリー: I. 歩みの違う奏者（短い型を並べた譜面を 4 人の奏者がそれぞれの歩みで繰り返しながら進み、高い主音のパルスが刻み続ける。上端の点が各奏者の位置）、II. 純正の響き（純正律に調律し直したピアノで、ゆっくりした分散和音が 1 音ずつ伸びては縮む。右端に鳴っている音の比が出る）、III. 持続音と旋法（低い持続音の上で、速い型が音を足したり移したりしながら繰り返され、熱を帯びて駆け上がって終わる）。ジェルジ・リゲティ: I. 一音から（1 つの音名だけで始め、区切りごとに音名を 1 つずつ加えながら速くなり、取っておいた最後の音名で終わる。上端の枠が使える音名）、II. 止まっていくメトロノーム（たくさんのメトロノームがそれぞれの速さで一斉に刻み始め、止まったものから抜けて、最後の 1 つが残る。クリックで 1 つ加わる）、III. 無秩序（右手は白鍵、左手は黒鍵だけで休まず刻み、強い音で旋律を浮かべる。右手がときどき 1 拍縮んで左手とずれていき、両手とも登りつめて突然終わる）。",
        en: "Whose sonata to play. Toshi Ichiyanagi: I. Shifting repetitions (two hands' patterns of different lengths drift apart and end when their starts meet), II. Ma (chance notes and long silences), III. Toccata (a fast line grows one note at a time, widening and speeding up). Steve Reich: I. Phase (both hands play the same pattern; one creeps ahead a note at a time until they meet again after 12 shifts, and the chord moves every 3 shifts), II. Pulsing chords (repeated chords swell and fade over a breath, moving step by step back to the first chord), III. Build-up (rests become notes one at a time, other hands build the same pattern at an offset, then it thins back to rests). Brian Eno: I. Loops of different lengths (short phrases on loops of different lengths pile up, then thin out), II. Echoes (each note repeats at a fixed interval, fading, and the echoes overlap into chords), III. Melody from rules (simple rules such as moving to a neighbouring note or resting now and then make the melody, over slow low notes). Arvo Pärt: I. Tintinnabuli (triad notes follow the melody by rule; phrases toward a central note grow and shrink from above and below), II. Bells and canon (three voices play the same falling phrase at 1, 2 and 4 times slower among bells, stopping as they reach the root), III. Mirror (two lines open and close around a central note like a mirror over a broken-chord left hand). Conlon Nancarrow: I. Acceleration and deceleration (the high voice keeps speeding up while the low voice keeps slowing down, trading speeds midway), II. Boogie-woogie layers (right-hand riffs at 3:2, 5:4 and 7:4 of the boogie-woogie bass pile up and drop out), III. Converging canon (four voices play the same melody at different speeds, the slowest starting first, all meeting on the last note). Morton Feldman (everything is very quiet): I. Irregular repetitions (short patterns of uneven lengths repeat a few times with small changes, earlier patterns return now and then, and the first comes back at the end), II. Shaded chords (soft, widely spaced chords are held and repeated with one note moved by a semitone each time, thinning out as it goes), III. Layers of memory (the left hand keeps up a small figure of close notes while right-hand patterns of other lengths come and go above). Terry Riley: I. Players at their own pace (four players work through a score of short modules, each repeating at their own pace over a steady high pulse; the dots at the top show where each player is), II. Just intonation (on a piano retuned to whole-number ratios, slow arpeggios grow and shrink a note at a time; the ratios of the sounding notes appear at the right), III. Drone and mode (over a low drone, fast patterns repeat while notes are added and moved, heating up into a final upward run). György Ligeti: I. From a single note (it starts with one pitch class and adds one per section while speeding up, saving the last for the final note; the boxes at the top show the pitch classes in use), II. Metronomes winding down (many metronomes start ticking at their own speeds and drop out as they run down until one is left; click to add one), III. Disorder (the right hand on white keys and the left on black keys play nonstop with accented melodies; the right hand now and then drops a beat and drifts ahead, and both climb until it stops abruptly).",
      },
    },
    "#scale": {
      title: { ja: "スケール", en: "Scale" },
      text: {
        ja: "音の高さの選び方（音階）です。「指定しない」を選ぶと、作曲家ごとの音階を使います（一柳慧は 12 音すべての半音階、ライヒはドリアン、イーノはメジャーペンタトニック）。ほかに、日本、中国、中近東、インド、バリ島、西洋の音階から選べます。",
        en: "The set of pitches to use. “None” uses each composer's own scale (chromatic for Ichiyanagi, Dorian for Reich, major pentatonic for Eno). You can also choose scales from Japan, China, the Middle East, India, Bali and the West.",
      },
    },
    "#reverb": {
      title: { ja: "響き", en: "Reverb" },
      text: {
        ja: "リバーブの深さと残響の長さです。1 でほぼ響きなし、3 が標準、5 でホールのように深く長く響きます。天気を使うと雲の量で、変化をオンにすると時間とともに、ここで選んだ響きを中心に深さが揺れます。",
        en: "Reverb depth and length. 1 is nearly dry, 3 is the default and 5 is deep and long like a hall. With weather on, cloud cover moves the depth around this setting, and Drift sways it over time.",
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
        ja: "ピアノの調律の具合です（コンロン・ナンカロウのときだけ選べます。ほかの作曲家は常にぴったり）。ぴったり: 平均律のとおり。少しずれ: 鍵ごとに少しずつ音程が外れます（同じ鍵はいつも同じずれ）。古いピアノ: ずれが大きくなり、1 つの鍵の弦どうしもそろわず、うなりのある酒場のピアノのような響きになります。",
        en: "How well the piano is tuned (only for Conlon Nancarrow; the other composers are always in tune). In tune: exact equal temperament. Slightly off: each key is a little out, always by the same amount. Old piano: keys are further out and the strings of each key disagree, giving a beating, honky-tonk sound.",
      },
    },
    "#movement": {
      title: { ja: "楽章", en: "Movement" },
      text: {
        ja: "今の楽章です。選ぶと、その楽章の始めから鳴らします。そこから先の楽章も続けて鳴ります。",
        en: "The current movement. Choosing one plays it from the start, and the following movements continue after it.",
      },
    },
    '[data-section="performance"] h2': {
      title: { ja: "演奏と評価", en: "Performance and ratings" },
      text: {
        ja: "楽章を鳴らしている間（と次の楽章が始まるまで）、左下に「良い・普通・ダメ」のボタンが出ます（キーの 1・2・3 でも押せます）。押すと、その楽章の評価を、種・設定・天気・その日に何楽章目か・直前の楽章と、鳴った音から計算した特徴量（音域の幅、跳躍や繰り返しの割合、主音で終わったかなど）と一緒に記録します。押し直すと評価を置き換えます。記録はこのブラウザの中だけに残り、JSON や CSV で書き出して傾向を調べられます。",
        en: "While a movement plays (and until the next one starts), Good / OK / Bad buttons appear at the bottom left (or press 1, 2, 3). Rating saves it with the seed, settings, weather, how many movements you'd heard that day, the previous movement, and features computed from the notes played (range, share of leaps and repeats, whether it ended on the root and so on). Rating again replaces it. Ratings stay in this browser only; export them as JSON or CSV to look for trends.",
      },
    },
    "#seed": {
      title: { ja: "種", en: "Seed" },
      text: {
        ja: "演奏の材料（型・旋律・和音の順番など）を決める乱数の種です。空のときは、I から始めるたびに新しい種を引きます。今の種は画面の右下に出ます。良かった演奏の種を入れると（「今の演奏の種を使う」でも入ります）、同じ演奏をもう一度聴けます。ただし天気・変化・音域・密度・テンポが違うと、同じ種でも違う演奏になります。種は URL にも残ります。",
        en: "The random seed that picks the material of a performance (patterns, melodies, the order of chords and so on). When empty, a new seed is drawn each time the sonata starts from movement I. The current seed is shown at the bottom right. Enter the seed of a performance you liked (or press \"Use this performance's seed\") to hear the same performance again. Weather, Drift, register, density and tempo still change it. The seed is kept in the URL.",
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
        ja: "4 分音符の速さです。一柳慧の I と III、ライヒの I は 16 分音符、ライヒの II と III は 8 分音符で刻みます。イーノの楽章は刻みを持たないので、テンポは効きません。ペルトでは 1 音の長さが決まります（I は 2 拍、II は 1 拍から 4 拍、III は 8 分音符の刻みと 2 拍の旋律）。ナンカロウでは、I は駆ける速さ、II は左手の 8 分音符、III は旋律の音の数が決まります（III の途中で変えても効きません）。フェルドマンでは、1 拍の長さ（型や和音の間合い）が決まります。ライリーでは、I のパルス（8 分音符）、II の分散和音の速さ、III の 16 分音符が決まります。リゲティでは、I の始めの速さ、II のメトロノームの速さ（始めるとき）、III の 16 分音符が決まります。天気を使うと、気温でさらに速くなったり遅くなったりします。",
        en: "Quarter-note tempo. Ichiyanagi I and III and Reich I move in sixteenths, Reich II and III in eighths. Eno's movements have no pulse, so tempo doesn't affect them. In Pärt it sets the note lengths (two beats in I, one to four beats in II, eighths and half notes in III). In Nancarrow it sets how fast the runs go in I, the bass eighths in II, and how many notes the melody has in III (changing it mid-movement has no effect there). In Feldman it sets the beat that the patterns and chords are spaced by. In Riley it sets the eighth-note pulse in I, the arpeggio speed in II and the sixteenths in III. In Ligeti it sets the starting speed in I, the metronome speeds in II (when it starts) and the sixteenths in III. With weather on, temperature makes it faster or slower.",
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
};
