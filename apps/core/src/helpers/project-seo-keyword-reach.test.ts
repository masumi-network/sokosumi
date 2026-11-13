import { describe, expect, it } from "vitest";
import { siteStrategyReport } from "@/test-fixtures/project-seo";
import { seoTopicWords } from "./project-seo-keyword-reach";
import { parsePublicSeoArtifact } from "./project-seo-report";

const pages = (keywords: Array<string | [string, number | null]>) => [
  {
    header: {
      focusKeywords: keywords.map((row) =>
        typeof row === "string"
          ? { keyword: row, volume: 10 }
          : { keyword: row[0], volume: row[1] },
      ),
    },
    keywordOpportunities: null,
  },
];
const SITE_KEYWORDS = [
  "MacBook battery app",
  "battery health",
  "macbook charge limit",
  "mac battery timer",
  "macbook fan",
];
const reachRow = {
  feature: "Low battery alert",
  keyword: "macbook low battery warning",
  volume: 50,
  demand: 50,
  reach: "open",
  position: null,
  note: null,
};
const idea = {
  topic: "how long should a macbook battery last",
  feature: "Cycle count",
  conversion: "low",
  keyword: "how long does a macbook battery last",
  demand: 320,
  reach: "in reach",
  position: null,
  note: null,
  suggestions: [{ keyword: "macbook battery life years", volume: 90 }],
};
const rival = (host: string, keywords: string[]) => ({
  host,
  fetchedAt: "2026-11-13T12:36:36.755Z",
  total: 347,
  rows: keywords.map((keyword, index) => ({
    keyword,
    volume: 100 - index,
    position: index + 1,
    url: `https://${host}/${index}`,
  })),
  note: null,
});

function imported(extra: Record<string, unknown>) {
  const base = siteStrategyReport();
  return parsePublicSeoArtifact({ ...base, ...extra }).strategy;
}

describe("keyword reach sections of a site report", () => {
  it("keeps the feature reach, the article ideas and each product's keywords with a topic mark", () => {
    const strategy = imported({
      pages: siteStrategyReport().pages.map((page) => ({
        ...page,
        header: {
          ...page.header,
          focusKeywords: SITE_KEYWORDS.map((keyword) => ({
            ...page.header.focusKeywords[0],
            keyword,
            volume: 10,
          })),
        },
      })),
      featureReach: { rows: [reachRow], note: null },
      articleIdeas: { ideas: [idea], note: null },
      rivalKeywords: [
        rival("fiplab.com", ["battery health mac", "clipboard manager"]),
        { ...rival("coco.test", []), rows: null, note: "the read failed" },
        {
          ...rival("bad.test", ["macbook fan"]),
          rows: [
            {
              keyword: "macbook fan",
              volume: 5,
              position: 2,
              url: "javascript:alert(1)",
            },
          ],
        },
      ],
    });
    expect(strategy?.verdict).toBe("keep");
    expect(strategy?.featureReach).toEqual([reachRow]);
    expect(strategy?.articleIdeas).toEqual([
      {
        topic: idea.topic,
        feature: idea.feature,
        keyword: idea.keyword,
        demand: 320,
        reach: "in reach",
        position: null,
        note: null,
        suggestions: idea.suggestions,
      },
    ]);
    // A host whose read failed shows nothing; a link that is no plain web address loses the link, not the row.
    expect(strategy?.rivalKeywords).toEqual([
      {
        host: "fiplab.com",
        total: 347,
        topicWords: ["macbook", "battery"],
        rows: [
          {
            keyword: "battery health mac",
            volume: 100,
            position: 1,
            url: "https://fiplab.com/0",
            topic: true,
          },
          {
            keyword: "clipboard manager",
            volume: 99,
            position: 2,
            url: "https://fiplab.com/1",
            topic: false,
          },
        ],
      },
      {
        host: "bad.test",
        total: 347,
        topicWords: ["macbook", "battery"],
        rows: [
          {
            keyword: "macbook fan",
            volume: 5,
            position: 2,
            url: null,
            topic: true,
          },
        ],
      },
    ]);
  });

  it("drops a section it cannot read or that exceeds its caps, never the strategy or another section", () => {
    const strategy = imported({
      featureReach: { rows: [{ ...reachRow, volume: "50" }] },
      articleIdeas: { ideas: Array.from({ length: 11 }, () => idea) },
      rivalKeywords: [rival("fiplab.com", ["clipboard manager"])],
    });
    expect(strategy?.verdict).toBe("keep");
    expect(strategy?.featureReach).toBeUndefined();
    expect(strategy?.articleIdeas).toBeUndefined();
    // The fixture site has too few keyword rows for topic words: no row is marked.
    expect(strategy?.rivalKeywords?.[0]).toMatchObject({
      topicWords: [],
      rows: [{ keyword: "clipboard manager", topic: false }],
    });
    // A host Core cannot read is dropped alone; rows past the cap are cut, the first ones kept.
    const hosts = imported({
      rivalKeywords: [
        { ...rival("fiplab.com", ["clipboard manager"]), host: "" },
        rival(
          "coco.test",
          Array.from({ length: 101 }, (_, i) => `keyword ${i}`),
        ),
        rival("ok.test", ["battery app"]),
      ],
    })?.rivalKeywords;
    expect(hosts?.map((host) => [host.host, host.rows.length])).toEqual([
      ["coco.test", 100],
      ["ok.test", 1],
    ]);
    expect(hosts?.[0]?.rows.at(-1)?.keyword).toBe("keyword 99");
    // More readable hosts than Core keeps: the first ones, never a lost strategy. A host Core cannot read gives its
    // place to the next one.
    const four = imported({
      rivalKeywords: ["", "a.test", "b.test", "c.test", "d.test"].map((host) =>
        rival(host, ["battery app"]),
      ),
    });
    expect(four?.verdict).toBe("keep");
    expect(four?.rivalKeywords?.map((host) => host.host)).toEqual([
      "a.test",
      "b.test",
      "c.test",
    ]);
    // More topic words than Core keeps, and one longer than a label, cut the words, not the host.
    const many = [
      "x".repeat(101),
      ...Array.from({ length: 51 }, (_, i) => `w${i}`),
    ].join(" ");
    const wide = imported({
      pages: siteStrategyReport().pages.map((page) => ({
        ...page,
        header: {
          ...page.header,
          focusKeywords: Array.from({ length: 5 }, (_, i) => ({
            ...page.header.focusKeywords[0],
            keyword: `${many} r${i}`,
            volume: 10,
          })),
        },
      })),
      rivalKeywords: [rival("ok.test", ["w0 app"])],
    })?.rivalKeywords?.[0];
    expect(wide?.topicWords).toHaveLength(50);
    expect(wide?.rows[0]?.topic).toBe(true);
    // Empty sections and a Report from before them give nothing.
    const empty = imported({
      featureReach: { rows: [], note: "no Market" },
      articleIdeas: { note: "the rule did not ask" },
      rivalKeywords: [],
    });
    expect(empty?.featureReach).toBeUndefined();
    expect(empty?.articleIdeas).toBeUndefined();
    expect(empty?.rivalKeywords).toBeUndefined();
  });

  it("reads the site's topic words as the SEO bot does (its rival-keywords tests)", () => {
    expect(seoTopicWords(pages(SITE_KEYWORDS))).toEqual(["macbook", "battery"]);
    expect(
      seoTopicWords(
        pages([
          "battery saver",
          "mac battery",
          "mac charge",
          "mac timer",
          "mac fan",
        ]),
      ),
    ).toEqual(["mac"]);
    // Fewer than 5 rows, filler words, list words and numbers alone give no topic word.
    expect(seoTopicWords(pages(SITE_KEYWORDS.slice(0, 4)))).toEqual([]);
    expect(
      seoTopicWords(
        pages([
          "how to fix a battery",
          "how to charge a battery",
          "how to read battery health",
          "how to calibrate",
          "battery for mac",
        ]),
      ),
    ).toEqual(["battery"]);
    expect(
      seoTopicWords(
        pages([
          "best battery app 80",
          "best mac fan 80",
          "best charge limit 80",
          "battery",
          "fan",
        ]),
      ),
    ).toEqual([]);
    // A row without searches does not count, and one keyword counts once whatever its case and spaces.
    expect(
      seoTopicWords(
        pages([
          ...SITE_KEYWORDS.slice(0, 4),
          ["macbook fan", null],
          "MacBook  Battery App",
        ]),
      ),
    ).toEqual([]);
    expect(seoTopicWords("not pages")).toEqual([]);
    // One keyword in two Unicode forms counts once (4 rows, too few); a row Core cannot read does not count.
    expect(
      seoTopicWords(
        pages([
          "caf\u00e9 app",
          "cafe\u0301 app",
          "caf\u00e9 x",
          "tea y",
          "tea z",
        ]),
      ),
    ).toEqual([]);
    const [page] = pages(SITE_KEYWORDS);
    expect(
      seoTopicWords([
        {
          ...page,
          header: {
            focusKeywords: [...page.header.focusKeywords, { keyword: 5 }],
          },
        },
      ]),
    ).toEqual(["macbook", "battery"]);
  });
});
