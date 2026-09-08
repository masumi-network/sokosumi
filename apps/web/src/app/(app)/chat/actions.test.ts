import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

const { getThreadMock, getMessageMock } = vi.hoisted(() => ({
  getThreadMock: vi.fn(),
  getMessageMock: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  chatRoomService: {
    getThread: getThreadMock,
    getMessage: getMessageMock,
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

import { getRoomMessageAction, getRoomThreadAction } from "./actions";

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

describe("getRoomMessageAction", () => {
  beforeEach(() => {
    getMessageMock.mockReset();
  });

  it("passes a refused message through as no message", async () => {
    getMessageMock.mockResolvedValue(null);

    // Null is a success carrying nothing, not a failure. The lookup reads it
    // as "the reader cannot have this one" and leaves them in the room; a
    // failure would send them back to the room for the same id.
    await expect(getRoomMessageAction("room-1", "msg-1")).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("reports a thrown failure as a failure", async () => {
    getMessageMock.mockRejectedValue(new Error("Boom"));

    const result = await getRoomMessageAction("room-1", "msg-1");

    expect(result.ok).toBe(false);
  });
});
