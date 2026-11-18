import { beforeEach, describe, expect, it, vi } from "vitest";

const getTaskByIdMock = vi.fn();
const getMySokoBotActivityMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getTaskById: (...args: unknown[]) => getTaskByIdMock(...args),
    getMySokoBotActivity: () => getMySokoBotActivityMock(),
  },
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getPrivateCachedSession: async () => null,
}));
const hasAssignedSeatMock = vi.fn();
const resolvePlanMock = vi.fn();
vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: {
    hasAssignedSeat: (...args: unknown[]) => hasAssignedSeatMock(...args),
  },
}));
vi.mock("@/app/tasks/utils/task-activity-plan", () => ({
  resolveTaskDetailViewerPlan: (...args: unknown[]) => resolvePlanMock(...args),
}));
vi.mock("@/app/tasks/utils/task-assignee-members", () => ({
  listTaskAssigneeMemberOptions: async () => [],
}));

const { getPrivateCachedTask, startPrivateTaskDetailReads } = await import(
  "./private-task-detail-cache"
);
const { CoreApiRequestError } = await import("@/lib/clients/core.request");

function coreError(status: number) {
  return new CoreApiRequestError(`Core answered ${status}`, { status });
}

describe("getPrivateCachedTask", () => {
  beforeEach(() => {
    getTaskByIdMock.mockReset();
  });

  it("reads a task Core does not have in this workspace as null", async () => {
    getTaskByIdMock.mockRejectedValue(coreError(404));

    await expect(getPrivateCachedTask("SOK-1")).resolves.toBeNull();
  });

  // A "use cache" entry keeps a returned value but never a thrown error. An
  // outage must throw, so no later read in the same request gets a cached
  // "not found" for a task that exists.
  it("throws on any other Core failure instead of caching it as missing", async () => {
    getTaskByIdMock.mockRejectedValue(coreError(503));

    await expect(getPrivateCachedTask("SOK-1")).rejects.toThrow(
      "Core answered 503",
    );
  });
});

// A hover prefetch keeps whatever these reads settle to. A rejection would be
// kept as the error page the click opens, out of the refresh's reach.
describe("startPrivateTaskDetailReads", () => {
  it("degrades a failed seat or plan read instead of rejecting", async () => {
    hasAssignedSeatMock.mockRejectedValue(new Error("Core answered 503"));
    resolvePlanMock.mockRejectedValue(new Error("Core answered 503"));
    const task = {
      projectId: null,
      organizationId: "org-1",
      visibility: "PRIVATE",
      workspace: { organizationId: "org-1" },
    } as unknown as Parameters<typeof startPrivateTaskDetailReads>[0];

    const reads = startPrivateTaskDetailReads(task, false);

    await expect(reads.hasAssignedSeatPromise).resolves.toBe(false);
    await expect(reads.currentPlanPromise).resolves.toBeNull();
  });

  // Only Core's "no bot" sends the viewer to setup instead of following.
  it.each([
    [200, true],
    [404, false],
    [503, true],
  ])("reads a Soko Bot activity %s as has-bot %s", async (status, expected) => {
    if (status === 200)
      getMySokoBotActivityMock.mockResolvedValue({ data: {} });
    else getMySokoBotActivityMock.mockRejectedValue(coreError(status));
    const task = {
      projectId: null,
      organizationId: "org-1",
      visibility: "PRIVATE",
      workspace: { organizationId: "org-1" },
    } as unknown as Parameters<typeof startPrivateTaskDetailReads>[0];

    const reads = startPrivateTaskDetailReads(task, false);

    await expect(reads.viewerHasSokoBotPromise).resolves.toBe(expected);
  });

  it("keeps a sign-in redirect from the seat read", async () => {
    const { redirect } = await import("next/navigation");
    hasAssignedSeatMock.mockImplementation(async () => redirect("/signin"));
    resolvePlanMock.mockResolvedValue(null);
    const task = {
      projectId: null,
      organizationId: "org-1",
      visibility: "PRIVATE",
      workspace: { organizationId: "org-1" },
    } as unknown as Parameters<typeof startPrivateTaskDetailReads>[0];

    const reads = startPrivateTaskDetailReads(task, false);

    await expect(reads.hasAssignedSeatPromise).rejects.toThrow("NEXT_REDIRECT");
  });
});
