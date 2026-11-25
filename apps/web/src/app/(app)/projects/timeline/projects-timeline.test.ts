import { describe, expect, it } from "vitest";

import {
  buildTimeline,
  type TimelineTask,
  timelineWeeks,
} from "./projects-timeline";

function task(
  id: string,
  projectId: string | null,
  dueOn: string,
): TimelineTask {
  return { id, projectId, dueOn, name: id, href: `/tasks/${id}` };
}

describe("timelineWeeks", () => {
  it("starts on this week's Monday and spans eight weeks", () => {
    // 2026-11-25 is a Wednesday.
    const weeks = timelineWeeks("2026-11-25");
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toBe("2026-11-23");
    expect(weeks[7]).toBe("2027-01-11");
  });

  it("keeps a Sunday in its own week", () => {
    expect(timelineWeeks("2026-11-29")[0]).toBe("2026-11-23");
  });
});

describe("buildTimeline", () => {
  const projects = [
    { id: "p1", name: "Launch" },
    { id: "p2", name: "Quiet" },
  ];

  it("puts each Task in its project's week and overdue before today", () => {
    const rows = buildTimeline(projects, "2026-11-25", [
      task("late", "p1", "2026-11-24"),
      task("today", "p1", "2026-11-25"),
      task("next", "p1", "2026-12-01"),
    ]);

    expect(rows[0]?.overdue.map((t) => t.id)).toEqual(["late"]);
    expect(rows[0]?.weeks[0]?.map((t) => t.id)).toEqual(["today"]);
    expect(rows[0]?.weeks[1]?.map((t) => t.id)).toEqual(["next"]);
  });

  it("keeps projects with nothing due, so an empty row reads as no dates", () => {
    const rows = buildTimeline(projects, "2026-11-25", []);

    expect(rows.map((row) => row.project.id)).toEqual(["p1", "p2"]);
    expect(rows[1]?.hasDueTasks).toBe(false);
  });

  it("leaves out Tasks without a listed project or past the last week", () => {
    const rows = buildTimeline(projects, "2026-11-25", [
      task("loose", null, "2026-11-26"),
      task("closed-project", "p9", "2026-11-26"),
      task("far", "p1", "2027-01-18"),
    ]);

    expect(rows.every((row) => !row.hasDueTasks)).toBe(true);
  });
});
