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

  it("never sends sort params (Core recents are fixed activityAt desc)", async () => {
    getDriveRecentsMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveRecentsPage({ scope: "me", q: "report" });

    const call = getDriveRecentsMock.mock.calls[0]?.[0] as {
      query: Record<string, unknown>;
    };
    expect(call.query).toMatchObject({
      scope: "me",
      limit: DRIVE_RECENTS_PAGE_LIMIT,
      q: "report",
    });
    expect(call.query).not.toHaveProperty("sortBy");
    expect(call.query).not.toHaveProperty("sortOrder");
  });
});
