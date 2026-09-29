import { describe, expect, it } from "vitest";

import { sessionIdFromUrl } from "../../../../../../agents/image-studio/agent/channels/eve";

/**
 * The channel policy authorizes a request against the session it names, so
 * finding that name has to be right for every route and every mount.
 *
 * Missing a session id here is a fail-open: the request would be treated as a
 * session creation and skip the binding check entirely.
 */
describe("sessionIdFromUrl", () => {
  it("finds the id on every session route", () => {
    for (const path of [
      "/eve/v1/session/wrun_1",
      "/eve/v1/session/wrun_1/stream",
      "/eve/v1/session/wrun_1/cancel",
      "/eve/v1/session/wrun_1/clear",
      "/eve/v1/session/wrun_1/reset",
      "/eve/v1/session/wrun_1/compact",
    ]) {
      expect(sessionIdFromUrl(`http://agent.test${path}`)).toBe("wrun_1");
    }
  });

  it("finds it behind a public mount prefix", () => {
    // The browser talks to `/eve/image-studio/v1/...`; the agent sees whatever
    // the proxy forwards.
    expect(
      sessionIdFromUrl("http://agent.test/eve/image-studio/v1/session/wrun_2"),
    ).toBe("wrun_2");
  });

  it("returns null for session creation, which names no session", () => {
    expect(sessionIdFromUrl("http://agent.test/eve/v1/session")).toBeNull();
    expect(sessionIdFromUrl("http://agent.test/eve/v1/session/")).toBeNull();
  });

  it("returns null for unrelated routes", () => {
    expect(sessionIdFromUrl("http://agent.test/eve/v1/health")).toBeNull();
    expect(sessionIdFromUrl("::::")).toBeNull();
  });

  it("takes the last session segment when a path repeats it", () => {
    expect(
      sessionIdFromUrl("http://agent.test/session/x/eve/v1/session/wrun_3"),
    ).toBe("wrun_3");
  });
});
