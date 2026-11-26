import { describe, expect, it } from "vitest";
import {
  changeThenDraftsChecks,
  type SavedPost,
} from "./eval-cmo-change-then-drafts";

const draft = (text: string, extra: Partial<SavedPost> = {}): SavedPost => ({
  provider: "x",
  status: "DRAFT",
  text,
  scheduledAt: null,
  ...extra,
});
const failed = (posts: SavedPost[], linkedinCadence: string | null) =>
  changeThenDraftsChecks({ posts, linkedinCadence })
    .filter((check) => !check.pass)
    .map((check) => check.label);

describe("the change-then-drafts case reads what was saved", () => {
  const three = [draft("One"), draft("Two"), draft("Three")];

  it("passes three different waiting X drafts and a weekly LinkedIn", () => {
    expect(failed(three, "1 post a week")).toEqual([]);
    expect(failed(three, "Once a week")).toEqual([]);
    expect(failed(three, "weekly")).toEqual([]);
  });

  it("fails a turn that stopped after the strategy change", () => {
    expect(failed([], "once a week")).toEqual([
      "Saves 3 different X drafts on his Project",
    ]);
  });

  it("fails fewer than three different drafts", () => {
    expect(
      failed([draft("One"), draft("one "), draft("Two")], "once a week"),
    ).toEqual(["Saves 3 different X drafts on his Project"]);
    expect(
      failed(
        [draft("One"), draft("Two"), draft("Three", { provider: "linkedin" })],
        "once a week",
      ),
    ).toContain("Saves 3 different X drafts on his Project");
  });

  it("fails a scheduled or published post", () => {
    const scheduled = [
      ...three,
      draft("Four", {
        status: "SCHEDULED",
        scheduledAt: new Date("2026-12-01T09:00:00Z"),
      }),
    ];
    expect(failed(scheduled, "once a week")).toEqual([
      "Schedules or publishes none of them",
    ]);
    expect(
      failed(
        [
          draft("One"),
          draft("Two"),
          draft("Three", { scheduledAt: new Date("2026-12-01T09:00:00Z") }),
        ],
        "once a week",
      ),
    ).toEqual([
      "Saves 3 different X drafts on his Project",
      "Schedules or publishes none of them",
    ]);
  });

  it("fails a LinkedIn cadence that did not change", () => {
    expect(failed(three, "3 posts a week")).toEqual([
      "Saves LinkedIn at once a week",
    ]);
    expect(failed(three, null)).toEqual(["Saves LinkedIn at once a week"]);
  });
});
