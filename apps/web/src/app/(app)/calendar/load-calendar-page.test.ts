import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceCalendarSourcesMock = vi.fn();
const listCoworkersMock = vi.fn();
const listTaskAssigneeMemberOptionsMock = vi.fn();
const getCoworkerOptionsMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getWorkspaceCalendarSources: () => getWorkspaceCalendarSourcesMock(),
  },
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: () => listCoworkersMock(),
  },
}));

vi.mock("@/app/tasks/utils/task-assignee-members", () => ({
  listTaskAssigneeMemberOptions: (organizationId: string | null) =>
    listTaskAssigneeMemberOptionsMock(organizationId),
}));

vi.mock("@/app/tasks/utils/coworker-options", () => ({
  getCoworkerOptions: (coworkers: unknown[]) =>
    getCoworkerOptionsMock(coworkers),
}));

import {
  loadCalendarPageContext,
  resolveCalendarPageQuery,
} from "./load-calendar-page";

describe("resolveCalendarPageQuery", () => {
  it("parses a known Task status and a calendar date", () => {
    const result = resolveCalendarPageQuery("2026-06-18", "READY");

    expect(result.calendarStatus).toBe("READY");
    expect(result.initialDate).toBe("2026-06-18");
    expect(result.range.from).toBeInstanceOf(Date);
    expect(result.range.to).toBeInstanceOf(Date);
  });

  it("drops an unknown status filter", () => {
    const result = resolveCalendarPageQuery(undefined, "not-a-status");

    expect(result.calendarStatus).toBeUndefined();
  });
});

describe("loadCalendarPageContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceCalendarSourcesMock.mockResolvedValue([
      { sourceId: "project:1" },
    ]);
    listCoworkersMock.mockResolvedValue([{ id: "coworker-1" }]);
    listTaskAssigneeMemberOptionsMock.mockResolvedValue([
      { id: "user-1", kind: "user" },
    ]);
    getCoworkerOptionsMock.mockReturnValue([
      { id: "coworker-1", kind: "coworker" },
    ]);
  });

  it("joins member options with coworker options and returns sources", async () => {
    const result = await loadCalendarPageContext("org-1");

    expect(listTaskAssigneeMemberOptionsMock).toHaveBeenCalledWith("org-1");
    expect(result.sources).toEqual([{ sourceId: "project:1" }]);
    expect(result.coworkerOptions).toEqual([
      { id: "user-1", kind: "user" },
      { id: "coworker-1", kind: "coworker" },
    ]);
  });

  it("returns empty sources when the sources read fails", async () => {
    getWorkspaceCalendarSourcesMock.mockRejectedValue(new Error("offline"));

    const result = await loadCalendarPageContext(null);

    expect(result.sources).toEqual([]);
  });
});
