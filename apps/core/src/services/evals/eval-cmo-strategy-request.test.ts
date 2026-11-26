import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import {
  delegatedChoiceChecks,
  mixedRequestChecks,
} from "./eval-cmo-strategy-request";

const entry = (id: string, channel: string, title: string) => ({
  id,
  channel,
  title,
  date: "2026-12-01",
  format: "post",
});
const plan = (
  channels: Record<string, string>,
  calendar = [
    entry("x1", "x", "Booking in one click"),
    entry("li1", "linkedin", "Routing"),
  ],
) =>
  ({
    channels: Object.entries(channels).map(([channel, cadence]) => ({
      channel,
      cadence,
    })),
    calendar,
  }) as unknown as MarketingStrategyPlan;

const BEFORE = plan({ linkedin: "3 posts a week", x: "1 a day" });
const failedLabels = (checks: { label: string; pass: boolean }[]) =>
  checks.filter((check) => !check.pass).map((check) => check.label);

describe("a mixed strategy request", () => {
  it("passes LinkedIn saved at twice a week with X untouched", () => {
    const saved = plan({ linkedin: "2 posts a week", x: "1 a day" });
    expect(failedLabels(mixedRequestChecks({ before: BEFORE, saved }))).toEqual(
      [],
    );
  });

  it("fails when only a failed save happened (nothing saved)", () => {
    expect(
      failedLabels(mixedRequestChecks({ before: BEFORE, saved: null })),
    ).toEqual([
      "Saves LinkedIn at two posts a week",
      "Leaves X as it was until the owner answers",
    ]);
  });

  it("fails when X was rewritten on a guess", () => {
    const saved = plan({ linkedin: "2 posts a week", x: "1 a day" }, [
      entry("x1", "x", "Why demos stall"),
      entry("li1", "linkedin", "Routing"),
    ]);
    expect(failedLabels(mixedRequestChecks({ before: BEFORE, saved }))).toEqual(
      ["Leaves X as it was until the owner answers"],
    );
  });
});

describe("a choice the owner left to Cuso", () => {
  it("passes any network whose cadence changed", () => {
    const saved = plan({ linkedin: "5 posts a week", x: "1 a day" });
    expect(
      failedLabels(delegatedChoiceChecks({ before: BEFORE, saved })),
    ).toEqual([]);
  });

  it("fails a failed save and a save that changed no cadence", () => {
    const label = ["Saves a change to how often a network posts"];
    expect(
      failedLabels(delegatedChoiceChecks({ before: BEFORE, saved: null })),
    ).toEqual(label);
    const same = plan({ linkedin: "three a week", x: "daily" });
    expect(
      failedLabels(delegatedChoiceChecks({ before: BEFORE, saved: same })),
    ).toEqual(label);
  });
});
