import { describe, expect, it } from "vitest";

import { chatRouteErrorBoundaryKey } from "../chat-route-error-boundary.client";

describe("chatRouteErrorBoundaryKey", () => {
  it("uses pathname alone when there is no search", () => {
    expect(chatRouteErrorBoundaryKey("/")).toBe("/");
    expect(chatRouteErrorBoundaryKey("/", new URLSearchParams())).toBe("/");
  });

  it("includes search so draft Welcome views remount separately", () => {
    expect(
      chatRouteErrorBoundaryKey("/", new URLSearchParams("create=channel")),
    ).toBe("/?create=channel");
    expect(chatRouteErrorBoundaryKey("/", new URLSearchParams("dm=new"))).toBe(
      "/?dm=new",
    );
  });

  it("changes when soft-navigating between shared-pathname views", () => {
    const home = chatRouteErrorBoundaryKey("/", new URLSearchParams());
    const create = chatRouteErrorBoundaryKey(
      "/",
      new URLSearchParams("create=channel"),
    );
    const dm = chatRouteErrorBoundaryKey("/", new URLSearchParams("dm=new"));

    expect(home).not.toBe(create);
    expect(create).not.toBe(dm);
    expect(home).not.toBe(dm);
  });
});
