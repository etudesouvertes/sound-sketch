// 世界のインターネットラジオの局を Radio Browser (radio-browser.info) から探す。Tape と Radio で共有する。
// ブラウザから音を取り出せる局（https で、HLS でなく、フレームに切って音に戻せる形式。stream.ts）だけを返す

export const RADIO_API = "https://all.api.radio-browser.info";
const RADIO_CODECS = ["MP3", "AAC", "AAC+"];

export type Station = {
  stationuuid: string;
  name: string;
  countrycode: string;
  url_resolved: string;
  codec: string;
  hls: number;
  tags: string;
};

// all: すべての局、talk: 話の多い局（news / talk などのタグ）、weather: 天気予報の局。
// noaa: wxradio.org が中継するアメリカの NOAA Weather Radio だけ（設定では選べない。録音モードで使う。アメリカ政府の放送は
// パブリックドメインなので、録音を投稿できる）
export type StationKind = "all" | "talk" | "weather" | "noaa";

export type StationFilter = {
  kind: StationKind;
  skipPolitics: boolean; // 政治色の強い局を除く
  skipReligion: boolean; // 宗教の局を除く
};

// 話の多い局を探すタグ（部分一致なので、"news talk" や "talk & speech" なども含む）
const SPEECH_TAGS = ["talk", "news", "spoken"];
// 天気予報の局。"weather" のタグはニュースの中で天気を伝えるだけの音楽の局にも付くので、局の名前で見分ける
// （アメリカの NOAA Weather Radio、上海天气台、Météo など）
const WEATHER_SEARCHES = ["tag=weather", "tag=noaa", "name=weather", "name=noaa", "name=météo", "name=meteo", "name=天气", "name=wetter"];
const WEATHER_NAME = /weather|noaa|m[ée]t[ée]o(?!r)|天气|天氣|wetter/i; // Radio Meteor のような名前には当てない
// 天気予報の局は、Radio Browser のほかに wxradio.org（アメリカの NOAA Weather Radio を各地の受信機から中継している
// Icecast のサーバー）からも取る。中継している放送の一覧は、Icecast の status-json.xsl で取れる
const WXRADIO = "https://wxradio.org";
type IcecastSource = { listenurl: string; server_type?: string };

// 中継の名前（"TX-Dallas-KEC56"、"MI-Hesperia-WWF36-alt1"）から、州・町・コールサインを取り出す
function wxradioStation(source: IcecastSource): Station | null {
  const mount = source.listenurl.split("/").pop() ?? "";
  const match = /^([A-Z]{2})-([^-]+)-([A-Z]{1,3}\d+)/.exec(mount);
  if (!match) return null;
  const [, state, town, call] = match;
  const place = town.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  const type = source.server_type ?? "";
  return {
    stationuuid: `wxradio:${call}`,
    name: `NOAA ${place}, ${state}`,
    countrycode: "US",
    url_resolved: `${WXRADIO}/${mount}`,
    codec: /aac/i.test(type) ? "AAC" : "MP3",
    hls: 0,
    tags: "weather",
  };
}

async function wxradioStations(): Promise<Station[]> {
  const response = await fetch(`${WXRADIO}/status-json.xsl`);
  const json = await response.json();
  const sources: IcecastSource[] = [json.icestats?.source ?? []].flat();
  return sources.map(wxradioStation).filter((s): s is Station => s !== null);
}

// 政治色の強い局。局の名前とタグで見分ける（progressive rock のような音楽のジャンルは除かない）
const POLITICAL =
  /politi|propagand|conservative|liberal\b|progressive(?!\s*(rock|house|trance|metal|psy|music))|patriot|government|opinion|activis|socialis|communis|nationalis|election|sputnik|voice of korea/i;
// 宗教の局。局の名前とタグで見分ける（Christchurch のような地名や、フランス語の émission には当てない）
const RELIGIOUS =
  /christ(?!church)|(?<!christ)church|religi|islam|muslim|quran|coran|gospel|sermon|preach|bible|biblical|worship|catholi|evangel|pentecost|baptist|adventist|jesus|cristo|cristian|iglesia|igreja|kirche|\bkerk|église|chrétien|hindu|bhajan|buddhis|sikh|gurbani|kirtan|jewish|torah|devotion|spiritual|faith|ministr|prayer|radio mar[ií]a|vatican|dharma|\bgod\b|\blord\b|salvation|hymn|holy|sacred|messianic|apostol|missionar/i;

// 条件（"tag=talk" や "name=noaa"）で探す
async function searchStations(search?: string, limit = 40): Promise<Station[]> {
  const query = new URLSearchParams(search);
  for (const [key, value] of Object.entries({ hidebroken: "true", is_https: "true", order: "random", limit: String(limit) })) {
    query.set(key, value);
  }
  const response = await fetch(`${RADIO_API}/json/stations/search?${query}`);
  return response.json();
}

// 条件に合う局を、ランダムな順で返す
export async function findStations(filter: StationFilter): Promise<Station[]> {
  const searches =
    filter.kind === "talk"
      ? SPEECH_TAGS.map((tag) => searchStations(`tag=${tag}`))
      : filter.kind === "weather"
        ? [...WEATHER_SEARCHES.map((search) => searchStations(search, 200)), wxradioStations()]
        : filter.kind === "noaa"
          ? [wxradioStations()]
          : [searchStations()];
  // 探し方のどれかが失敗しても、ほかの結果は使う（すべて失敗したら、失敗として返す）
  const results = await Promise.allSettled(searches);
  const lists = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (lists.length === 0) throw (results[0] as PromiseRejectedResult).reason;
  // 同じ局（同じ放送の URL、wxradio.org の同じ送信所の別の中継）は 1 つにする
  const seen = new Set<string>();
  const stations = lists.flat().filter((s) => {
    const url = s.url_resolved.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (seen.has(s.stationuuid) || seen.has(url)) return false;
    seen.add(s.stationuuid);
    seen.add(url);
    if (filter.kind === "weather" && !WEATHER_NAME.test(s.name)) return false;
    if (filter.skipPolitics && POLITICAL.test(`${s.name} ${s.tags}`)) return false;
    if (filter.skipReligion && RELIGIOUS.test(`${s.name} ${s.tags}`)) return false;
    return s.hls === 0 && RADIO_CODECS.includes(s.codec.toUpperCase());
  });
  // いくつかのタグで探した局を混ぜる
  for (let i = stations.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [stations[i], stations[j]] = [stations[j], stations[i]];
  }
  return stations;
}

// 鳴らした局を Radio Browser に知らせる（局の人気の集計に使われる）
export function reportClick(station: Station) {
  if (station.stationuuid.startsWith("wxradio:")) return; // Radio Browser の局でない
  fetch(`${RADIO_API}/json/url/${station.stationuuid}`).catch(() => {});
}
