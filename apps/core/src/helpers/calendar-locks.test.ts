import { describe, expect, it, vi } from "vitest";

import { requireOpenCalendarProject } from "@/helpers/calendar-locks";

describe("requireOpenCalendarProject", () => {
  it("allows a Workspace calendar source without a Project lookup", async () => {
    const findFirst = vi.fn();

    await expect(
      requireOpenCalendarProject(
        { project: { findFirst } },
        "workspace-1",
        null,
      ),
    ).resolves.toBeUndefined();

    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    { closingAt: new Date("2026-09-14T10:00:00.000Z"), closedAt: null },
    { closingAt: null, closedAt: new Date("2026-09-14T10:00:00.000Z") },
  ])("rejects a closing or closed Project", async (project) => {
    const findFirst = vi.fn().mockResolvedValue(project);

    await expect(
      requireOpenCalendarProject(
        { project: { findFirst } },
        "workspace-1",
        "project-1",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
