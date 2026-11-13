import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  keywordGroups,
  keywordPage,
  keywordPositions,
  keywordReadFailed,
  keywordSummary,
  seoDifficultyBand,
} from "./seo-keyword-rows-model";

type Keyword = ProjectSeoWorkspace["keywords"][number];

let next = 0;
function row(patch: Partial<Keyword>): Keyword {
  next += 1;
  return {
    id: `k${next}`,
    keyword: "battery app",
    pageUrl: "https://example.com/",
    targetPageId: null,
    saved: false,
    countryCode: "US",
    languageCode: "en",
    source: "focus",
    volume: null,
    intent: null,
    difficulty: null,
    clicks: null,
    conversion: null,
    feature: null,
    device: null,
    position: null,
    positionStatus: "unavailable",
    checkedResults: null,
    observedAt: null,
    observationId: null,
    priority: "medium",
    version: 0,
    ...patch,
  };
}
const notFound = {
  positionStatus: "not_in_range",
  checkedResults: 17,
} as const;

describe("SEO keyword rows", () => {
  it("shows a keyword once, with one position read per device, mobile first", () => {
    const { checked, ideas } = keywordGroups([
      row({ device: "desktop", ...notFound, volume: 140 }),
      row({ device: "mobile", positionStatus: "ranked", position: 8 }),
      // The same keyword again as a competitor gap, in another letter case.
      row({
        keyword: "Battery App",
        source: "gap",
        volume: 90,
        intent: "commercial",
      }),
    ]);
    expect(ideas).toEqual([]);
    expect(checked).toHaveLength(1);
    expect(checked[0].reads.map((read) => read.device)).toEqual([
      "mobile",
      "desktop",
    ]);
    expect(checked[0]).toMatchObject({
      best: 8,
      volume: 140,
      sources: ["focus", "gap"],
    });
  });

  it("keeps the same keyword apart per page and per market", () => {
    const { checked } = keywordGroups([
      row({ device: "mobile", ...notFound }),
      row({
        device: "mobile",
        ...notFound,
        pageUrl: "https://example.com/guide",
      }),
      row({
        device: "mobile",
        ...notFound,
        countryCode: "DE",
        languageCode: "de",
      }),
    ]);
    expect(checked).toHaveLength(3);
  });

  it("lists a keyword without a position read as an idea, unless it is tracked", () => {
    const { checked, ideas } = keywordGroups([
      row({ keyword: "idea small", source: "opportunity", volume: 10 }),
      row({ keyword: "idea big", source: "gap", volume: 200 }),
      row({ keyword: "tracked", source: "saved", saved: true, version: 1 }),
    ]);
    expect(checked.map((group) => group.lead.keyword)).toEqual(["tracked"]);
    // The most searched idea leads.
    expect(ideas.map((group) => group.lead.keyword)).toEqual([
      "idea big",
      "idea small",
    ]);
  });

  it("puts ideas with a high or medium conversion estimate first, and keeps the checked order by rank", () => {
    const idea = (keyword: string, patch: Partial<Keyword>) =>
      row({ keyword, source: "opportunity", ...patch });
    const { checked, ideas } = keywordGroups([
      idea("most searched", { volume: 900 }),
      idea("low", { volume: 500, conversion: "low" }),
      idea("high small", {
        volume: 50,
        difficulty: null,
        clicks: null,
        conversion: "high",
        feature: "Low battery alerts",
      }),
      idea("high big", { volume: 70, conversion: "high" }),
      // A newer check that gives no estimate lists the keyword first: the estimate of the other row stays.
      // It has more searches than both "high" ideas: only the level puts it after them.
      row({ keyword: "medium", source: "gap", volume: 80 }),
      idea("medium", { volume: 80, conversion: "medium" }),
      // An older check named a feature; the newest estimate names none, so none shows.
      idea("medium", { conversion: "high", feature: "Older feature" }),
      row({
        keyword: "rank 8",
        positionStatus: "ranked",
        position: 8,
        difficulty: null,
        clicks: null,
        conversion: "high",
      }),
      row({ keyword: "rank 3", positionStatus: "ranked", position: 3 }),
    ]);
    expect(ideas.map((group) => group.lead.keyword)).toEqual([
      "high big",
      "high small",
      "medium",
      // No estimate is not worse than "low": the two share a place, the most searched first.
      "most searched",
      "low",
    ]);
    expect(ideas[1]).toMatchObject({
      difficulty: null,
      clicks: null,
      conversion: "high",
      feature: "Low battery alerts",
    });
    expect(ideas[2]).toMatchObject({
      difficulty: null,
      clicks: null,
      conversion: "medium",
      feature: null,
      sources: ["gap", "opportunity"],
    });
    expect(ideas[3]).toMatchObject({ conversion: null, feature: null });
    // A read keyword shows its estimate; its place is still by rank.
    expect(checked.map((group) => group.lead.keyword)).toEqual([
      "rank 3",
      "rank 8",
    ]);
    expect(checked[1].conversion).toBe("high");
  });

  it("keeps a tracked keyword first and a failed read out of the ideas", () => {
    const { checked, ideas } = keywordGroups([
      row({ keyword: "rank 3", positionStatus: "ranked", position: 3 }),
      // The check set out to read it; the read failed.
      row({ keyword: "read failed", device: "mobile" }),
      // The check lists the tracked keyword as a gap first; the tracked row carries the saved choice.
      row({ keyword: "tracked", source: "gap" }),
      row({ keyword: "tracked", source: "saved", saved: true, version: 4 }),
    ]);
    expect(ideas).toEqual([]);
    expect(checked.map((group) => group.lead.keyword)).toEqual([
      "tracked",
      "rank 3",
      "read failed",
    ]);
    expect(checked[0].lead.version).toBe(4);
  });

  it("takes the newest read of a device", () => {
    // Rows come newest first.
    const { checked } = keywordGroups([
      row({ device: "mobile", positionStatus: "ranked", position: 9 }),
      row({ device: "mobile", positionStatus: "ranked", position: 3 }),
    ]);
    expect(checked[0].reads.map((read) => read.position)).toEqual([9]);
  });

  it("shows the reads of a keyword's newest check only", () => {
    const old = {
      observationId: "old",
      observedAt: new Date("2026-09-01T12:00:00Z"),
      positionStatus: "ranked",
    } as const;
    const fresh = {
      ...old,
      observationId: "new",
      observedAt: new Date("2026-11-10T12:00:00Z"),
    };
    const { checked } = keywordGroups([
      // The newer check lists the keyword once, without a device.
      row({ keyword: "audit", source: "ranked", position: 4, ...fresh }),
      row({ keyword: "audit", device: "mobile", position: 9, ...old }),
      row({ keyword: "audit", device: "desktop", position: 12, ...old }),
      // The newer check read one device only: the old desktop read is not its result.
      // The dates decide, not the order of the rows.
      row({ keyword: "one device", device: "desktop", position: 12, ...old }),
      row({ keyword: "one device", device: "mobile", position: 3, ...fresh }),
    ]);
    expect(
      checked.map((group) => [
        group.lead.keyword,
        group.best,
        group.reads.map((read) => [read.device, read.position]),
      ]),
    ).toEqual([
      ["one device", 3, [["mobile", 3]]],
      ["audit", 4, [[null, 4]]],
    ]);
  });

  it("cuts the keywords of a check, tracked from the start, and keeps the reader's choices over the cut", () => {
    const fromCheck = Array.from({ length: 12 }, (_, index) =>
      row({
        keyword: `check ${index}`,
        saved: true,
        positionStatus: "ranked",
        position: index + 2,
      }),
    );
    const { checked } = keywordGroups([
      ...fromCheck,
      // The reader stopped tracking the best ranked keyword: it goes last.
      row({
        keyword: "stopped",
        version: 2,
        positionStatus: "ranked",
        position: 1,
      }),
      row({ keyword: "own", source: "saved", saved: true, version: 1 }),
    ]);
    expect(checked[0].lead.keyword).toBe("own");
    expect(checked.at(-1)?.lead.keyword).toBe("stopped");
    const page = keywordPage(checked, 10);
    // The stopped keyword stays in view, at the end: its "Track" is the way back.
    expect(page.rows.map((group) => group.lead.keyword)).toEqual([
      "own",
      ...fromCheck.slice(0, 10).map((item) => item.keyword),
      "stopped",
    ]);
    expect(page.more).toBe(2);
  });

  it("cuts the list after the reader's keywords, so they never push every read out of view", () => {
    const tracked = Array.from({ length: 10 }, (_, index) =>
      row({
        keyword: `tracked ${index}`,
        source: "saved",
        saved: true,
        version: 1,
      }),
    );
    const read = Array.from({ length: 12 }, (_, index) =>
      row({
        keyword: `read ${index}`,
        positionStatus: "ranked",
        position: index + 1,
      }),
    );
    const { checked } = keywordGroups([...read, ...tracked]);
    const page = keywordPage(checked, 10);
    expect(page.rows).toHaveLength(20);
    expect(page.rows.at(-1)?.lead.keyword).toBe("read 9");
    expect(page.more).toBe(2);
    expect(keywordPage(checked.slice(0, 15), 10).more).toBe(0);
    // A fold that would hide one row hides none.
    const eleven = keywordGroups(read.slice(0, 11)).checked;
    expect(keywordPage(eleven, 10)).toMatchObject({ more: 0 });
    expect(keywordPage(eleven, 10).rows).toHaveLength(11);
  });

  it("tells a failed read from a keyword no check has read", () => {
    const { checked } = keywordGroups([
      row({ keyword: "failed", device: "mobile" }),
      row({ keyword: "tracked", source: "saved", saved: true }),
      // A tracked keyword the check lists only as a gap was not read either.
      row({ keyword: "tracked gap", source: "gap", saved: true }),
    ]);
    expect(
      checked.map((group) => [group.lead.keyword, keywordReadFailed(group)]),
    ).toEqual([
      ["tracked", false],
      ["tracked gap", false],
      ["failed", true],
    ]);
  });

  it("orders checked keywords by best rank, then by searches", () => {
    const { checked } = keywordGroups([
      row({
        keyword: "unranked big",
        device: "mobile",
        ...notFound,
        volume: 900,
      }),
      row({
        keyword: "rank 12",
        positionStatus: "ranked",
        position: 12,
        volume: 5,
      }),
      row({ keyword: "rank 3", positionStatus: "ranked", position: 3 }),
      row({
        keyword: "unranked small",
        device: "mobile",
        ...notFound,
        volume: 20,
      }),
    ]);
    expect(checked.map((group) => group.lead.keyword)).toEqual([
      "rank 3",
      "rank 12",
      "unranked big",
      "unranked small",
    ]);
  });

  it("sums up the result: read, found, on the first page, and the newest read", () => {
    const { checked } = keywordGroups([
      row({
        keyword: "a",
        device: "mobile",
        positionStatus: "ranked",
        position: 10,
        observedAt: new Date("2026-11-11T00:26:00.000Z"),
      }),
      row({
        keyword: "a",
        device: "desktop",
        positionStatus: "ranked",
        position: 14,
      }),
      row({
        keyword: "b",
        positionStatus: "ranked",
        position: 11,
        observedAt: new Date("2026-11-11T00:37:00.000Z"),
      }),
      row({ keyword: "c", device: "mobile", ...notFound }),
      row({ keyword: "c", device: "desktop", ...notFound, checkedResults: 16 }),
      // Tracked, but no position read: not part of the result.
      row({ keyword: "d", source: "saved", saved: true, version: 1 }),
    ]);
    expect(keywordSummary(checked)).toMatchObject({
      read: 3,
      found: 2,
      firstPage: 1,
      // Only the reads that did not find the page give the depth: the ranked rows have none.
      depth: { min: 16, max: 17 },
      newest: {
        keyword: "b",
        observedAt: new Date("2026-11-11T00:37:00.000Z"),
      },
    });
    // One miss without a depth: no number holds for every "Not found".
    const unknown = keywordGroups([
      row({ keyword: "c", device: "mobile", ...notFound }),
      row({ keyword: "e", ...notFound, checkedResults: null }),
    ]);
    expect(keywordSummary(unknown.checked).depth).toBeNull();
    // Every keyword found: nothing to explain.
    const found = keywordGroups([
      row({ keyword: "a", positionStatus: "ranked", position: 4 }),
    ]);
    expect(keywordSummary(found.checked).depth).toBeNull();
  });

  it("writes one position line where the devices agree, else one per device", () => {
    const mobile = row({ device: "mobile", ...notFound });
    const desktop = row({ device: "desktop", ...notFound, checkedResults: 16 });
    expect(keywordPositions([mobile, desktop])).toEqual([
      { device: null, position: null },
    ]);
    const ranked = (device: "mobile" | "desktop", position: number) =>
      row({ device, positionStatus: "ranked", position });
    expect(
      keywordPositions([ranked("mobile", 4), ranked("desktop", 4)]),
    ).toEqual([{ device: null, position: 4 }]);
    expect(
      keywordPositions([ranked("mobile", 4), ranked("desktop", 9)]),
    ).toEqual([
      { device: "mobile", position: 4 },
      { device: "desktop", position: 9 },
    ]);
    // Found on one device only: both lines stay.
    expect(keywordPositions([ranked("mobile", 4), desktop])).toEqual([
      { device: "mobile", position: 4 },
      { device: "desktop", position: null },
    ]);
    // One read keeps its device: the other device was not read.
    expect(keywordPositions([mobile])).toEqual([
      { device: "mobile", position: null },
    ]);
  });
});

describe("seoDifficultyBand", () => {
  it("puts each difficulty in one band at the edges", () => {
    expect(seoDifficultyBand(null)).toBeNull();
    expect(seoDifficultyBand(0)).toBe("easy");
    expect(seoDifficultyBand(29)).toBe("easy");
    expect(seoDifficultyBand(30)).toBe("medium");
    expect(seoDifficultyBand(59)).toBe("medium");
    expect(seoDifficultyBand(60)).toBe("hard");
    expect(seoDifficultyBand(100)).toBe("hard");
  });
});
