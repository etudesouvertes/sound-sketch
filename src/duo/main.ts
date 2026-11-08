import { sonataPage } from "../sonata/page";
import { twoDrummers } from "./drummers";
import { twoEngineers } from "./engineers";
import { twoGuitarists } from "./guitarists";
import { twoKoras } from "./koras";
import { twoStringPlayers } from "./strings";

// ピアノ・デュオ: 2 台のピアノのためのソナタ。組ごとに独立した 3 楽章で、ピアノ I を左、II を右に置く。
// 組は、Sonata と同じく生まれた年の順（2 人のうち年上の方。弦楽器奏者は 1920 年、ドラマーは 1924 年、ギタリストは 1942 年、録音技師は 1962 年、コラ奏者は 1965 年）
sonataPage({
  page: "duo",
  works: [twoStringPlayers, twoDrummers, twoGuitarists, twoEngineers, twoKoras],
  pianos: 2,
  title: (key) => `Sonata for Two Pianos in ${key}`,
});
