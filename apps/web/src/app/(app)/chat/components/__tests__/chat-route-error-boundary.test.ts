import { describe, expect, it } from "vitest";

import { chatRouteErrorBoundaryKey } from "../chat-route-error-boundary.client";

describe("chatRouteErrorBoundaryKey", () => {
  it("preserves the room when a notification message is consumed or changed", () => {
    const pathname = "/chat/rooms/room-1";
    const roomKey = chatRouteErrorBoundaryKey(pathname);

    for (const search of ["message=reply-1", "message=reply-2", ""]) {
      expect(
        chatRouteErrorBoundaryKey(pathname, new URLSearchParams(search)),
      ).toBe(roomKey);
    }
  });

  it("keeps other query parameters when consuming a notification message", () => {
    expect(
      chatRouteErrorBoundaryKey(
        "/chat/rooms/room-1",
        new URLSearchParams("message=reply-1&notice=room-unavailable"),
      ),
    ).toBe("/chat/rooms/room-1?notice=room-unavailable");
  });

  it("uses pathname alone when there is no search", () => {
    expect(chatRouteErrorBoundaryKey("/")).toBe("/");
    expect(chatRouteErrorBoundaryKey("/", new URLSearchParams())).toBe("/");
  });

  it("includes search so Welcome notice remounts separately", () => {
    expect(
      chatRouteErrorBoundaryKey(
        "/",
        new URLSearchParams("notice=room-unavailable"),
      ),
    ).toBe("/?notice=room-unavailable");
  });

  it("changes when soft-navigating between shared-pathname views", () => {
    const home = chatRouteErrorBoundaryKey("/", new URLSearchParams());
    const notice = chatRouteErrorBoundaryKey(
      "/",
      new URLSearchParams("notice=room-unavailable"),
    );

    expect(home).not.toBe(notice);
  });
});
