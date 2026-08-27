import { describe, expect, it } from "vitest";

import { chatRouteErrorBoundaryKey } from "../chat-route-error-boundary.client";

describe("chatRouteErrorBoundaryKey", () => {
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
