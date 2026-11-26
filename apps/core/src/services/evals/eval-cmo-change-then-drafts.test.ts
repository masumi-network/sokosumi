import { describe, expect, it } from "vitest";
import {
  cadencePerWeek,
  changeThenDraftsChecks,
  type SavedPost,
} from "./eval-cmo-change-then-drafts";

const PROJECT = "cuso-project";
const DRAFTS = "Saves exactly 3 new, different X drafts on his Project";
const ELSEWHERE = "Writes no post to another Project";
const NOT_OUT = "Schedules or publishes none of them";
const WEEKLY = "Saves LinkedIn at one post a week";

const draft = (text: string, extra: Partial<SavedPost> = {}): SavedPost => ({
  projectId: PROJECT,
  provider: "x",
  status: "DRAFT",
  text,
  scheduledAt: null,
  ...extra,
});
const failed = (posts: SavedPost[], linkedinCadence: string | null) =>
  changeThenDraftsChecks({ projectId: PROJECT, posts, linkedinCadence })
    .filter((check) => !check.pass)
    .map((check) => check.label);

describe("the change-then-drafts case reads what was saved", () => {
  const three = [draft("One"), draft("Two"), draft("Three")];

  it("passes three different approvable X drafts and LinkedIn once a week", () => {
    for (const cadence of [
      "1 post a week",
      "Once a week, Tuesday 09:00",
      "weekly",
      "once every 7 days",
      "1x/week",
      "every week",
      "a post a week",
    ])
      expect(failed(three, cadence)).toEqual([]);
    expect(
      failed(
        [
          draft("One"),
          draft("Two", { status: "NEEDS_APPROVAL" }),
          draft("Three"),
        ],
        "one a week",
      ),
    ).toEqual([]);
  });

  it("fails a turn that stopped after the strategy change", () => {
    expect(failed([], "once a week")).toEqual([DRAFTS]);
  });

  it("fails fewer, more, repeated or other-network drafts", () => {
    expect(failed([draft("One"), draft("Two")], "once a week")).toEqual([
      DRAFTS,
    ]);
    expect(failed([...three, draft("Four")], "once a week")).toEqual([DRAFTS]);
    expect(
      failed([draft("One"), draft("one "), draft("Two")], "once a week"),
    ).toEqual([DRAFTS]);
    expect(
      failed(
        [draft("One"), draft("Two"), draft("Three", { provider: "linkedin" })],
        "once a week",
      ),
    ).toEqual([DRAFTS]);
  });

  it("names a post on another Project as its own failure", () => {
    expect(
      failed([...three, draft("Four", { projectId: "other" })], "once a week"),
    ).toEqual([ELSEWHERE]);
    expect(
      failed(
        [draft("One"), draft("Two"), draft("Three", { projectId: "other" })],
        "once a week",
      ),
    ).toEqual([DRAFTS, ELSEWHERE]);
  });

  it("fails a scheduled or published post", () => {
    expect(
      failed(
        [
          draft("One"),
          draft("Two"),
          draft("Three", {
            status: "SCHEDULED",
            scheduledAt: new Date("2026-12-01T09:00:00Z"),
          }),
        ],
        "once a week",
      ),
    ).toEqual([DRAFTS, NOT_OUT]);
    expect(
      failed(
        [draft("One"), draft("Two"), draft("Three", { status: "PUBLISHED" })],
        "once a week",
      ),
    ).toEqual([DRAFTS, NOT_OUT]);
  });

  it("fails a LinkedIn cadence other than one post a week", () => {
    for (const cadence of [
      "twice weekly",
      "3 posts weekly",
      "3x/week",
      "3x per week",
      "1-2 a week",
      "every other week",
      "once every 3 days",
      "daily",
      "posts on LinkedIn",
      "regularly",
      "0 posts weekly",
      "several posts weekly",
      "a few posts every week",
    ])
      expect([cadence, failed(three, cadence)]).toEqual([cadence, [WEEKLY]]);
    expect(failed(three, null)).toEqual([WEEKLY]);
  });
});

describe("cadencePerWeek", () => {
  it("reads an explicit quantity over an explicit interval", () => {
    expect(cadencePerWeek("twice weekly")).toBe(2);
    expect(cadencePerWeek("3 posts a week")).toBe(3);
    expect(cadencePerWeek("3x/week")).toBe(3);
    expect(cadencePerWeek("once every 7 days")).toBe(1);
    expect(cadencePerWeek("every other week")).toBe(0.5);
    expect(cadencePerWeek("2 a day")).toBe(14);
    expect(cadencePerWeek("4 posts a month")).toBeCloseTo((4 * 7 * 12) / 365);
  });

  it("never guesses one when it cannot read the cadence", () => {
    expect(cadencePerWeek("when there is news")).toBeNull();
    expect(cadencePerWeek("some posts a week")).toBeNull();
    expect(cadencePerWeek("regularly")).toBeNull();
    expect(cadencePerWeek("several posts weekly")).toBeNull();
    expect(cadencePerWeek("0 posts weekly")).toBe(0);
    expect(cadencePerWeek("weekly on LinkedIn")).toBe(1);
  });
});
