import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

const { getThreadMock } = vi.hoisted(() => ({
  getThreadMock: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  chatRoomService: {
    getThread: getThreadMock,
  },
  userService: {},
}));

vi.mock("@/lib/services/coworker.service", () => ({ coworkerService: {} }));
vi.mock("@/lib/services/soko-bot.service", () => ({ sokoBotService: {} }));
vi.mock("@/lib/auth/auth.server", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/app/chat/load-organization-members", () => ({
  loadOrganizationMembers: vi.fn(),
}));
vi.mock("@/app/components/private-sidebar-cache", () => ({
  invalidatePrivateSidebarChrome: vi.fn(),
}));

import { getRoomThreadAction } from "./actions";

describe("getRoomThreadAction", () => {
  beforeEach(() => {
    getThreadMock.mockReset();
  });

  it("marks a thread that is not there as NOT_FOUND", async () => {
    getThreadMock.mockResolvedValue(null);

    const result = await getRoomThreadAction("room-1", "msg-parent");

    // This code is the whole difference between a settled answer and a
    // fault. The room client stays quiet for it on the notification path and
    // complains about anything else, so a plain failure code here would put
    // an error toast back on a reader who followed a notification to a reply
    // whose parent has been deleted.
    expect(result).toEqual({
      ok: false,
      error: { code: CommonErrorCode.NOT_FOUND, message: expect.any(String) },
    });
  });

  it("reports a thrown failure as a failure", async () => {
    getThreadMock.mockRejectedValue(new Error("Boom"));

    const result = await getRoomThreadAction("room-1", "msg-parent");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
    }
  });
});
