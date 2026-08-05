import { describe, expect, it } from "vitest";

import { chatRouteErrorBoundaryKey } from "../chat-route-error-boundary.client";

describe("chatRouteErrorBoundaryKey", () => {
  it("uses pathname alone when there is no search", () => {
    expect(chatRouteErrorBoundaryKey("/chat")).toBe("/chat");
    expect(chatRouteErrorBoundaryKey("/chat", new URLSearchParams())).toBe(
      "/chat",
    );
  });

  it("includes search so draft /chat views remount separately", () => {
    expect(
      chatRouteErrorBoundaryKey("/chat", new URLSearchParams("create=channel")),
    ).toBe("/chat?create=channel");
    expect(
      chatRouteErrorBoundaryKey("/chat", new URLSearchParams("dm=new")),
    ).toBe("/chat?dm=new");
  });

  it("changes when soft-navigating between shared-pathname views", () => {
    const home = chatRouteErrorBoundaryKey("/chat", new URLSearchParams());
    const create = chatRouteErrorBoundaryKey(
      "/chat",
      new URLSearchParams("create=channel"),
    );
    const dm = chatRouteErrorBoundaryKey(
      "/chat",
      new URLSearchParams("dm=new"),
    );

    expect(home).not.toBe(create);
    expect(create).not.toBe(dm);
    expect(home).not.toBe(dm);
  });
});
