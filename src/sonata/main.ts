import { cage } from "./cage";
import { eno } from "./eno";
import { feldman } from "./feldman";
import { glass } from "./glass";
import { ichiyanagi } from "./ichiyanagi";
import { ligeti } from "./ligeti";
import { messiaen } from "./messiaen";
import { nancarrow } from "./nancarrow";
import { paert } from "./paert";
import { reich } from "./reich";
import { riley } from "./riley";
import { satie } from "./satie";
import { sonataPage } from "./page";

// 作曲家ごとに独立したピアノソナタ（1 台のピアノ）。並びは、作曲家の生まれた年の順（古い人から）。
// 同じ年に生まれた人は、ここで借りている作り方が出来上がった年の順
// （ケージのプリペアド・ピアノ 1940 年代 → ナンカロウの自動ピアノの習作 1948 年〜、ライリーの In C 1964 年 → ペルトのティンティナブリ 1976 年）
sonataPage({
  page: "sonata",
  works: [satie, messiaen, cage, nancarrow, ligeti, feldman, ichiyanagi, riley, paert, reich, glass, eno],
  pianos: 1,
  title: (key) => `Sonata in ${key}`,
});
