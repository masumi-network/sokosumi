import { err, ok } from "neverthrow";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const getSessionResultMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: () => getSessionResultMock(),
  getSession: () => getSessionMock(),
}));
vi.mock("@/lib/helpers/project-filter-options", () => ({
  getProjectFilterOptions: async () => [],
}));
vi.mock("@/app/tasks/utils/task-schedule-assignee-options", () => ({
  loadTaskScheduleAssigneeOptions: async () => ({
    selectableOptions: [],
    displayOptions: [],
  }),
}));
vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: { hasAssignedSeat: async () => true },
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: { getMyMembersWithOrganizations: async () => [] },
}));
vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: {
    listSchedules: async () => ({ schedules: [], nextCursor: null }),
    countSchedules: async () => 0,
  },
}));

const { loadSchedulesPageData } = await import("./schedules-page-data");

const SESSION = {
  user: { id: "user-1" },
  session: { activeOrganizationId: "org-1" },
};

function load() {
  return loadSchedulesPageData({ requestedProjectId: null, state: null });
}

describe("loadSchedulesPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionResultMock.mockReset();
    getSessionMock.mockReset();
  });

  // connection() would drop the page from every link prefetch.
  it("reads the page without deferring to the request", async () => {
    getSessionResultMock.mockResolvedValue(ok(SESSION));

    const data = await load();

    expect(data.activeOrganizationId).toBe("org-1");
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // The cached read must not keep an outage as "signed out", so the click
  // renders fresh and the page degrades as before.
  it("renders a session outage fresh on the click", async () => {
    getSessionResultMock.mockResolvedValue(err({ reason: "timeout" }));
    getSessionMock.mockResolvedValue(null);

    const data = await load();

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(data.activeOrganizationId).toBeNull();
  });

  // Any redirect thrown inside the cached read, such as a Core 401 from a
  // service, must reach the prefetch instead of the fresh fallback.
  it("keeps a sign-in redirect from the cached read", async () => {
    getSessionResultMock.mockImplementation(async () => redirect("/signin"));

    await expect(load()).rejects.toThrow("NEXT_REDIRECT");

    expect(connectionMock).not.toHaveBeenCalled();
  });
});
