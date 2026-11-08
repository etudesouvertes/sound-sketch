import { sonataPage } from "../sonata/page";
import { twoGuitarists } from "./guitarists";

// ピアノ・デュオ: 2 台のピアノのためのソナタ。組ごとに独立した 3 楽章で、ピアノ I を左、II を右に置く
sonataPage({
  page: "duo",
  works: [twoGuitarists],
  pianos: 2,
  title: (key) => `Sonata for Two Pianos in ${key}`,
});
