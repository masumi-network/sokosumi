import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getNotificationsMock } = vi.hoisted(() => ({
  getNotificationsMock: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: { getNotifications: getNotificationsMock },
}));

import { notificationService } from "./notification.service";

describe("Needs you read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Home shows a page of rows; its count is every open request the view
  // holds, a Job ask or another workspace's Task included, not the page.
  it("counts every request the view holds, not the page it shows", async () => {
    const rows = [
      { id: "task-ask", kind: "TASK" },
      { id: "job-ask", kind: "JOB" },
    ];
    getNotificationsMock.mockResolvedValueOnce({
      data: rows,
      meta: { pagination: { total: 7 } },
    });

    await expect(notificationService.readNeedsYou(2)).resolves.toEqual({
      notifications: rows,
      total: 7,
    });
    expect(getNotificationsMock).toHaveBeenCalledWith({
      needsAction: "true",
      limit: 2,
      projectId: undefined,
    });
  });

  it("falls back to the rows when Core sends no total", async () => {
    getNotificationsMock.mockResolvedValueOnce({ data: [{ id: "a" }] });
    await expect(notificationService.readNeedsYou(5)).resolves.toMatchObject({
      total: 1,
    });
  });
});
