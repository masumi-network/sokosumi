import { describe, expect, it } from "vitest";

import agent from "./agent";

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
    expect(typeof agent.model).toBe("string");
    expect(agent.model).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
  });

  it("keeps eve's default tools off", () => {
    // No sandbox, no bash, no filesystem, no web. The build command in
    // `next.config.ts` skips sandbox prewarm on the strength of this.
    expect(agent.defaultTools).toBe(false);
  });
});
