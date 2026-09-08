import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => useSessionMock(),
}));

import { useShowRoomUnreadCount } from "./use-show-room-unread-count";

function sessionWith(showRoomUnreadCount: boolean | null | undefined) {
  return { data: { user: { id: "user-1", showRoomUnreadCount } } };
}

describe("useShowRoomUnreadCount", () => {
  beforeEach(() => {
    useSessionMock.mockReset();
  });

  it("reads the reader's opt-in from the session", () => {
    useSessionMock.mockReturnValue(sessionWith(true));

    expect(renderHook(() => useShowRoomUnreadCount()).result.current).toBe(
      true,
    );
  });

  it("is off when the reader has not opted in", () => {
    useSessionMock.mockReturnValue(sessionWith(false));

    expect(renderHook(() => useShowRoomUnreadCount()).result.current).toBe(
      false,
    );
  });

  // The sidebar renders before the session resolves. Reading a missing session
  // as off is what stops a count flashing onto rows the reader never asked for.
  it("is off while the session is still loading", () => {
    useSessionMock.mockReturnValue({ data: null });

    expect(renderHook(() => useShowRoomUnreadCount()).result.current).toBe(
      false,
    );
  });

  it("is off for a reader whose session predates the preference", () => {
    useSessionMock.mockReturnValue(sessionWith(undefined));

    expect(renderHook(() => useShowRoomUnreadCount()).result.current).toBe(
      false,
    );
  });
});
