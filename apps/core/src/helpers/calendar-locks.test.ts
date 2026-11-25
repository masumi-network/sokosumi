import { PrismaRaw } from "@sokosumi/database/client";
import { describe, expect, it, vi } from "vitest";

import {
  lockCalendarScope,
  requireOpenCalendarProject,
} from "@/helpers/calendar-locks";

function capturedQuery([strings, ...values]: unknown[]) {
  return PrismaRaw.sql(strings as TemplateStringsArray, ...values);
}

describe("lockCalendarScope", () => {
  it("locks the actor before the Workspace and sorted Projects", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "workspace-1" }])
      .mockResolvedValueOnce([{ id: "project-a" }])
      .mockResolvedValueOnce([{ id: "project-b" }]);
    const tx = { $queryRaw: queryRaw };

    await expect(
      lockCalendarScope(
        tx,
        "workspace-1",
        ["project-b", "project-a", "project-a"],
        "user-1",
      ),
    ).resolves.toBe(true);

    expect(queryRaw).toHaveBeenCalledTimes(4);
    expect(capturedQuery(queryRaw.mock.calls[0]).sql).toContain(
      'FROM "public"."user"',
    );
    expect(capturedQuery(queryRaw.mock.calls[1]).sql).toContain(
      'FROM "public"."workspace"',
    );
    expect(capturedQuery(queryRaw.mock.calls[2]).values).toEqual([
      "project-a",
      "workspace-1",
    ]);
    expect(capturedQuery(queryRaw.mock.calls[3]).values).toEqual([
      "project-b",
      "workspace-1",
    ]);
  });

  it("does not lock the Calendar scope when the actor disappeared", async () => {
    const queryRaw = vi.fn().mockResolvedValueOnce([]);
    const tx = { $queryRaw: queryRaw };

    await expect(
      lockCalendarScope(tx, "workspace-1", [], "user-1"),
    ).resolves.toBe(false);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(capturedQuery(queryRaw.mock.calls[0]).sql).toContain(
      'FROM "public"."user"',
    );
  });
});

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
