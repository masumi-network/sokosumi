import { expect, it } from "vitest";
import { keywordGroups } from "./seo-keyword-rows-model";
import { assessKeywordIdeas, priorityFirst } from "./seo-keyword-shortlist";
import { seoTestKeyword } from "./seo-test-fixture";

function idea(id: string, now: number, gain: number, countryCode = "US") {
  return seoTestKeyword({
    id,
    keyword: id,
    countryCode,
    source: "opportunity",
    saved: false,
    position: null,
    positionStatus: "unavailable",
    conversion: "high",
    difficulty: 10,
    clicks: {
      now,
      top10: now + gain,
      top3: now + gain * 2,
      top1: now + gain * 3,
    },
  });
}

it("compares absolute and percentage gains within the original market even after filtering", () => {
  const { ideas } = keywordGroups([
    idea("small", 1, 2),
    idea("slow", 20, 10),
    idea("fast", 2, 10),
    idea("new", 0, 15),
    idea("different", 1, 1, "DE"),
  ]);
  const review = assessKeywordIdeas(ideas, ideas);
  expect(review.get("small")?.reason).toBe("smallerGain");
  expect(review.get("slow")?.reason).toBe("smallerLift");
  expect(review.get("fast")).toMatchObject({ reason: "priority", lift: 5 });
  expect(review.get("new")).toMatchObject({ reason: "priority", lift: null });
  expect(review.get("different")?.reason).toBe("priority");
  expect(
    assessKeywordIdeas(
      ideas.filter((g) => g.lead.id === "small"),
      ideas,
    ).get("small"),
  ).toEqual(review.get("small"));
  expect(
    ideas
      .toSorted((a, b) =>
        priorityFirst(review.get(a.lead.id), review.get(b.lead.id)),
      )
      .slice(0, 3)
      .map((g) => g.lead.id),
  ).toEqual(["new", "fast", "different"]);
});

it("keeps every qualifying idea and never substitutes missing evidence or zero gain", () => {
  const good = Array.from({ length: 6 }, (_, i) => idea(String(i), 0, 5));
  const { ideas } = keywordGroups([
    ...good,
    { ...idea("unknown", 0, 5), clicks: null },
    { ...idea("hard", 0, 5), difficulty: 70 },
    { ...idea("weak", 0, 5), conversion: "low" },
    idea("flat", 5, 0),
  ]);
  const decisions = assessKeywordIdeas(ideas);
  expect(
    [...decisions.values()].filter((row) => row.reason === "priority"),
  ).toHaveLength(6);
  expect(
    ["unknown", "hard", "weak", "flat"].map((id) => decisions.get(id)?.reason),
  ).toEqual(["gainUnknown", "competition", "low", "noGain"]);
});

it("includes measured zeros in the median and keeps audit order for tied priorities", () => {
  const { ideas } = keywordGroups([
    idea("flat1", 0, 0),
    idea("flat2", 0, 0),
    idea("middle", 0, 2),
    idea("large", 0, 8),
  ]);
  const assessments = assessKeywordIdeas(ideas);
  expect(assessments.get("middle")).toMatchObject({
    reason: "priority",
    medianExtra: 1,
  });
  const tied = [idea("z", 0, 5), idea("a", 0, 5)];
  const ordered = keywordGroups(tied).ideas;
  const decision = assessKeywordIdeas(ordered);
  expect(
    ordered
      .toReversed()
      .toSorted((a, b) =>
        priorityFirst(decision.get(a.lead.id), decision.get(b.lead.id)),
      ),
  ).toEqual(ordered);
});

it("ranks other ideas by estimated extra clicks in both views", () => {
  const { ideas } = keywordGroups([
    { ...idea("small", 1, 2), conversion: "low" },
    { ...idea("large", 1, 20), conversion: "low" },
  ]);
  const review = assessKeywordIdeas(ideas);
  expect(
    priorityFirst(review.get("small"), review.get("large")),
  ).toBeGreaterThan(0);
});
