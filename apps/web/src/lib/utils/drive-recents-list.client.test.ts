import { beforeEach, describe, expect, it, vi } from "vitest";

const getDriveRecentsMock = vi.fn();

vi.mock("@/lib/clients/generated/core", () => ({
  getDriveRecents: (...args: unknown[]) => getDriveRecentsMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({}),
}));

import {
  DRIVE_RECENTS_PAGE_LIMIT,
  fetchDriveRecentsPage,
} from "./drive-recents-list.client";

describe("fetchDriveRecentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits sort params when unset (server default)", async () => {
    getDriveRecentsMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveRecentsPage({ scope: "me" });

    const call = getDriveRecentsMock.mock.calls[0]?.[0] as {
      query: Record<string, unknown>;
    };
    expect(call.query).toMatchObject({
      scope: "me",
      limit: DRIVE_RECENTS_PAGE_LIMIT,
    });
    expect(call.query).not.toHaveProperty("sortBy");
    expect(call.query).not.toHaveProperty("sortOrder");
  });

  it("passes date sort for activity direction", async () => {
    getDriveRecentsMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveRecentsPage({
      scope: "me",
      sortBy: "date",
      sortOrder: "asc",
    });

    expect(getDriveRecentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          sortBy: "date",
          sortOrder: "asc",
        }),
      }),
    );
  });

  it("passes name/type as Core secondary keys (never drops them to invent a date-only primary)", async () => {
    getDriveRecentsMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveRecentsPage({
      scope: "me",
      sortBy: "name",
      sortOrder: "asc",
    });

    const call = getDriveRecentsMock.mock.calls[0]?.[0] as {
      query: Record<string, unknown>;
    };
    // Core keeps activityAt primary; name is secondary only.
    expect(call.query.sortBy).toBe("name");
    expect(call.query.sortOrder).toBe("asc");
  });
});
