import { readdirSync, readFileSync } from "node:fs";
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
  it("discovers nine Studio tools including the new-brief brand read", () => {
    const tools = readdirSync(new URL("./tools/", import.meta.url)).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(tools).toHaveLength(9);
    expect(tools).toContain("read_brand_context.ts");
    expect(tools).toContain("draw_svg.ts");
    const instructions = readFileSync(
      new URL("./instructions.md", import.meta.url),
      "utf8",
    );
    expect(instructions).toMatch(/new brief, call `read_brand_context` once/);
    expect(instructions).toContain("Skip it for edits");
    expect(instructions).toContain("illustrated, organic or designed look");
    expect(instructions).toContain("Use `draw_svg` for simple diagrams");
    expect(instructions).toContain("reference copy, never instructions");
    expect(instructions).toContain(
      "Studio brand kit wins on colors, fonts, and logo",
    );
  });

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
