import { afterEach, describe, expect, it, vi } from "vitest";

import agent from "./agent";
import { studioRouterForSession } from "./lib/router-trial";

afterEach(() => vi.unstubAllEnvs());

/**
 * What the studio agent needs from the environment it is deployed into.
 *
 * This is a deployment contract, not a taste check. The agent ships as a
 * service inside the Web deployment, and the credential it reaches for is
 * decided entirely by the shape of `model`: a Gateway id string goes through
 * `AI_GATEWAY_API_KEY`, while a provider-authored model object goes to that
 * provider's own key. Sokosumi provisions the first and not the second, so a
 * change back to `anthropic()` would leave the studio configured everywhere a
 * person can see and still fail at the first model call.
 */
describe("image studio agent", () => {
  it("selects its model through the AI Gateway", () => {
    vi.stubEnv("STUDIO_AGENT_ROUTER_TRIAL", undefined);
    const baseline = {
      model: "anthropic/claude-sonnet-5",
      arm: "router:sonnet-5",
    };
    expect(studioRouterForSession("session-2")).toEqual(baseline);
    vi.stubEnv("STUDIO_AGENT_ROUTER_TRIAL", "off");
    expect(studioRouterForSession("session-2")).toEqual(baseline);
    vi.stubEnv("STUDIO_AGENT_ROUTER_TRIAL", "opus");
    const opus = { model: "anthropic/claude-opus-5.5", arm: "router:opus-5.5" };
    expect(studioRouterForSession("session-2")).toEqual(opus);
    expect(studioRouterForSession("session-1")).toEqual(baseline);
    expect(studioRouterForSession("session-2")).toEqual(opus);
  });

  it("rejects unknown trial settings", () => {
    vi.stubEnv("STUDIO_AGENT_ROUTER_TRIAL", "on");
    expect(() => studioRouterForSession("session-1")).toThrow();
  });

  it("keeps eve's default tools off", () => {
    // No sandbox, no bash, no filesystem, no web. The build command in
    // `next.config.ts` skips sandbox prewarm on the strength of this.
    expect(agent.defaultTools).toBe(false);
  });
});
