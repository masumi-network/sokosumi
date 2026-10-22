import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

const {
  createRoomMock,
  getSessionMock,
  getThreadMock,
  invalidatePrivateSidebarChromeMock,
} = vi.hoisted(() => ({
  createRoomMock: vi.fn(),
  getSessionMock: vi.fn(),
  getThreadMock: vi.fn(),
  invalidatePrivateSidebarChromeMock: vi.fn(),
}));

vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    createRoom: createRoomMock,
    getThread: getThreadMock,
  },
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: {},
}));

vi.mock("@/lib/services/coworker.service", () => ({ coworkerService: {} }));
vi.mock("@/lib/services/soko-bot.service", () => ({ sokoBotService: {} }));
vi.mock("@/lib/auth/auth.server", () => ({ getSession: getSessionMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/app/chat/load-organization-members", () => ({
  loadOrganizationMembers: vi.fn(),
}));
vi.mock("@/app/components/private-sidebar-cache", () => ({
  invalidatePrivateSidebarChrome: invalidatePrivateSidebarChromeMock,
}));

import {
  ensureCoworkerDirectRoomAction,
  ensureSokoBotDirectRoomAction,
  getRoomThreadAction,
} from "./actions";

describe("direct room create-or-get", () => {
  const room = { id: "room-1" };

  beforeEach(() => {
    createRoomMock.mockReset();
    invalidatePrivateSidebarChromeMock.mockReset();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
  });

  it.each([
    ["coworker", () => ensureCoworkerDirectRoomAction("coworker-1")],
    ["Soko Bot", () => ensureSokoBotDirectRoomAction("bot-1")],
  ])(
    "opens an existing %s room without invalidating the page",
    async (_kind, open) => {
      createRoomMock.mockResolvedValue({ room, created: false });

      await expect(open()).resolves.toEqual({ ok: true, value: room });
      expect(invalidatePrivateSidebarChromeMock).not.toHaveBeenCalled();
    },
  );

  it("refreshes the sidebar cache when the room is new", async () => {
    createRoomMock.mockResolvedValue({ room, created: true });

    await expect(ensureCoworkerDirectRoomAction("coworker-1")).resolves.toEqual(
      { ok: true, value: room },
    );
    expect(invalidatePrivateSidebarChromeMock).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
    });
  });
});

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
