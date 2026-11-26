import { describe, expect, it } from "vitest";
import {
  cadencePerWeek,
  changeThenDraftsChecks,
  type SavedPost,
} from "./eval-cmo-change-then-drafts";

const PROJECT = "cuso-project";
const DRAFTS =
  "Saves exactly 3 new, different X drafts on his Project and nothing else";
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
    expect(failed(three, "1 post a week")).toEqual([]);
    expect(failed(three, "Once a week, Tuesday 09:00")).toEqual([]);
    expect(failed(three, "weekly")).toEqual([]);
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

  it("fails fewer, more, repeated, other-network or misplaced drafts", () => {
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
    expect(
      failed([...three, draft("Four", { projectId: "other" })], "once a week"),
    ).toEqual([DRAFTS]);
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
    expect(failed(three, "twice weekly")).toEqual([WEEKLY]);
    expect(failed(three, "3 posts weekly")).toEqual([WEEKLY]);
    expect(failed(three, "1-2 a week")).toEqual([WEEKLY]);
    expect(failed(three, "every other week")).toEqual([WEEKLY]);
    expect(failed(three, "daily")).toEqual([WEEKLY]);
    expect(failed(three, null)).toEqual([WEEKLY]);
  });
});

describe("cadencePerWeek", () => {
  it("reads quantity and period", () => {
    expect(cadencePerWeek("twice weekly")).toBe(2);
    expect(cadencePerWeek("3 posts a week")).toBe(3);
    expect(cadencePerWeek("2 a day")).toBe(14);
    expect(cadencePerWeek("4 posts a month")).toBeCloseTo(48 / 52);
    expect(cadencePerWeek("when there is news")).toBeNull();
  });
});
