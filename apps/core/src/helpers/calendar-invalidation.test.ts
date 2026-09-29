import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureExceptionMock, findWorkspaceMock, syncInvalidationsMock } =
  vi.hoisted(() => ({
    captureExceptionMock: vi.fn(),
    findWorkspaceMock: vi.fn(),
    syncInvalidationsMock: vi.fn(),
  }));

vi.mock("@sentry/node", () => ({ captureException: captureExceptionMock }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: findWorkspaceMock },
  },
}));
vi.mock("@/services/calendar-invalidation-outbox.service", () => ({
  calendarInvalidationOutboxService: {
    syncInvalidations: syncInvalidationsMock,
  },
}));

import {
  deliverCalendarInvalidationsNow,
  deliverOrganizationCalendarInvalidationsNow,
} from "./calendar-invalidation";

describe("deliverCalendarInvalidationsNow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findWorkspaceMock.mockResolvedValue({ id: "workspace_1" });
    syncInvalidationsMock.mockResolvedValue({
      claimed: 1,
      published: 1,
      failed: 0,
    });
  });

  it("resolves an organization workspace before draining revocations", async () => {
    await deliverOrganizationCalendarInvalidationsNow("organization_1");

    expect(findWorkspaceMock).toHaveBeenCalledWith({
      where: { organizationId: "organization_1" },
      select: { id: true },
    });
    expect(syncInvalidationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace_1" }),
    );
  });

  it("targets the former member's durable revocation", async () => {
    await deliverOrganizationCalendarInvalidationsNow(
      "organization_1",
      "user_1",
    );

    expect(syncInvalidationsMock).toHaveBeenCalledWith({
      maxBatches: 1,
      newestFirst: true,
      revokedUserId: "user_1",
      shouldContinue: expect.any(Function),
      workspaceId: "workspace_1",
    });
  });

  it("does nothing when the organization workspace no longer exists", async () => {
    findWorkspaceMock.mockResolvedValueOnce(null);

    await deliverOrganizationCalendarInvalidationsNow("organization_1");

    expect(syncInvalidationsMock).not.toHaveBeenCalled();
  });

  it("runs a bounded delivery pass for the committed workspace", async () => {
    await deliverCalendarInvalidationsNow("workspace_1");

    expect(syncInvalidationsMock).toHaveBeenCalledWith({
      maxBatches: 1,
      newestFirst: true,
      shouldContinue: expect.any(Function),
      workspaceId: "workspace_1",
    });
  });

  it("keeps delivery failures from changing a committed mutation response", async () => {
    const error = new Error("database unavailable");
    syncInvalidationsMock.mockRejectedValue(error);

    await expect(
      deliverCalendarInvalidationsNow("workspace_1"),
    ).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        extra: expect.objectContaining({ workspaceId: "workspace_1" }),
      }),
    );
  });
});
