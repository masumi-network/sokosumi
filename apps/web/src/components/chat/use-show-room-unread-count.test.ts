import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => useSessionMock(),
}));

import { useShowRoomUnreadCount } from "./use-show-room-unread-count";

function sessionWith(hideRoomUnreadCount: boolean | null | undefined) {
  return { data: { user: { id: "user-1", hideRoomUnreadCount } } };
}

describe("useShowRoomUnreadCount", () => {
  beforeEach(() => {
    useSessionMock.mockReset();
  });

  // On by default (ADR-0038): the count is shown unless the reader said no.
  it("shows the count to a reader who never chose", () => {
    useSessionMock.mockReturnValue(sessionWith(false));

    expect(renderHook(() => useShowRoomUnreadCount()).result.current).toBe(
      true,
    );
  });

  it("hides the count from a reader who switched it off", () => {
    useSessionMock.mockReturnValue(sessionWith(true));

    expect(renderHook(() => useShowRoomUnreadCount()).result.current).toBe(
      false,
    );
  });

  // A session minted before the field existed carries no value for it. That
  // reader never chose either, so they get the default.
  it("shows the count for a session that predates the preference", () => {
    useSessionMock.mockReturnValue(sessionWith(undefined));

    expect(renderHook(() => useShowRoomUnreadCount()).result.current).toBe(
      true,
    );
  });

  // The sidebar renders before the session resolves, and only the session
  // knows whether this reader switched the count off. Waiting costs a reader
  // who wants it a beat; guessing would flash it at one who does not.
  it("shows nothing while the session is still loading", () => {
    useSessionMock.mockReturnValue({ data: null });

    expect(renderHook(() => useShowRoomUnreadCount()).result.current).toBe(
      false,
    );
  });

  // The superseded field is still on old sessions. It must not count.
  it("ignores the superseded opt-in field", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          id: "user-1",
          showRoomUnreadCount: false,
          hideRoomUnreadCount: false,
        },
      },
    });

    expect(renderHook(() => useShowRoomUnreadCount()).result.current).toBe(
      true,
    );
  });
});
