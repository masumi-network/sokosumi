import { expect, it } from "vitest";

import { cmoBilling } from "../test-fixtures/cmo";
import { monthLabel, monthPostCount, planChosen, planCount } from "./strategy";

const entry = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    date: "2026-11-20",
    channel: "x",
    format: "post",
    title: id,
    status: "idea",
    ...extra,
  }) as Parameters<typeof monthPostCount>[0][number];

it("counts the same month the same before and after approval", () => {
  const video = entry("v1", {
    format: "talking_video",
    alsoOn: ["facebook", "instagram"],
  });
  const draft = [entry("a"), entry("b", { status: "skipped" }), video];
  const approved = [
    entry("a"),
    entry("b", { status: "skipped" }),
    video,
    entry("v1-facebook", { channel: "facebook", videoOf: "v1" }),
    entry("v1-instagram", { channel: "instagram", videoOf: "v1" }),
  ];
  expect(monthPostCount(draft)).toBe(4);
  expect(monthPostCount(approved)).toBe(4);
});

it("counts search ads as ads, not posts", () => {
  const month = [
    entry("a"),
    entry("b", { channel: "linkedin" }),
    entry("ad1", { channel: "google_ads", format: "search ad" }),
    entry("ad2", { channel: "google_ads", format: "search ad" }),
  ];
  expect(monthPostCount(month)).toBe(2);
  expect(monthLabel(month)).toBe("2 posts and 2 ads");
  expect(monthLabel(month.slice(0, 1))).toBe("1 post");
});

it("says planned and in your plan when the plan bought makes fewer", () => {
  const month = [entry("a"), entry("b"), entry("c")];
  expect(planCount(month, ["c"]).label).toBe("3 planned, 2 in your plan");
  expect(planCount(month, []).label).toBe("3 posts");
});

it("knows a plan is chosen only with a CMO plan or Tester credits", () => {
  expect(
    planChosen({
      billing: cmoBilling({ tier: null, hasTesterCredits: false }),
    }),
  ).toBe(false);
  expect(planChosen({ billing: cmoBilling({ tier: "growth" }) })).toBe(true);
  expect(
    planChosen({ billing: cmoBilling({ tier: null, hasTesterCredits: true }) }),
  ).toBe(true);
});
