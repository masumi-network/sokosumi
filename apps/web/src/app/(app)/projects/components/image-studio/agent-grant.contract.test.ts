import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  mintGrant,
  verifyGrant,
} from "../../../../../../agents/image-studio/agent/lib/grant";

/**
 * The agent and Core each carry their own small HMAC helper, on purpose: the
 * agent compiles as a separate service and must not import Core's module
 * graph. That leaves one thing to pin down — the two must agree on the wire
 * format, or every tool call is a 401 that only shows up at runtime.
 *
 * This test re-implements Core's verifier inline from its documented shape,
 * rather than importing it, because importing Core from a web test would
 * recreate exactly the coupling the split exists to avoid.
 */

const SECRET = "c".repeat(48);

/** Core's verification, as `apps/core/src/lib/image-studio/agent-grant.ts` does it. */
function coreVerify(
  token: string,
  secret: string,
  audience: "browser" | "agent" = "agent",
  now = new Date(),
) {
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "v2") return null;
  const [, tokenAudience, userId, projectId, expiresAtRaw, signature] =
    parts as [string, string, string, string, string, string];
  const expected = crypto
    .createHmac("sha256", secret)
    .update(["v2", tokenAudience, userId, projectId, expiresAtRaw].join("."))
    .digest("base64url");
  if (expected !== signature) return null;
  // A grant names the surface it may be spent at, and Core checks it.
  if (tokenAudience !== audience) return null;
  if (Math.floor(now.getTime() / 1000) >= Number(expiresAtRaw)) return null;
  return { userId, projectId };
}

describe("studio grant wire format", () => {
  beforeEach(() => {
    process.env.IMAGE_STUDIO_AGENT_SECRET = SECRET;
  });

  it("produces a grant Core accepts", () => {
    const token = mintGrant({ userId: "user-1", projectId: "project-1" });

    expect(coreVerify(token, SECRET)).toEqual({
      userId: "user-1",
      projectId: "project-1",
    });
  });

  it("accepts the token Web mints for the browser", () => {
    // Web signs the identical payload; the agent's channel verifies it.
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const payload = [
      "v2",
      "browser",
      "user-1",
      "project-1",
      String(expiresAt),
    ].join(".");
    const webToken = `${payload}.${crypto
      .createHmac("sha256", SECRET)
      .update(payload)
      .digest("base64url")}`;

    expect(verifyGrant(webToken)).toEqual({
      userId: "user-1",
      projectId: "project-1",
    });
  });

  it("keeps the browser's token and the agent's token apart", () => {
    // Same format, same secret. Without the audience the page's token was a
    // working credential at Core's agent surface, and the agent's token would
    // have opened the agent's own channel.
    const agentToken = mintGrant({ userId: "user-1", projectId: "project-1" });
    expect(coreVerify(agentToken, SECRET, "agent")).not.toBeNull();
    expect(coreVerify(agentToken, SECRET, "browser")).toBeNull();
    // The channel only accepts "browser", so it refuses the agent's own grant.
    expect(verifyGrant(agentToken)).toBeNull();
  });

  it("rejects a token whose project was swapped after signing", () => {
    const token = mintGrant({ userId: "user-1", projectId: "project-1" });
    expect(verifyGrant(token.replace("project-1", "project-2"))).toBeNull();
    expect(
      coreVerify(token.replace("project-1", "project-2"), SECRET),
    ).toBeNull();
  });

  it("refuses to mint without a configured secret", () => {
    process.env.IMAGE_STUDIO_AGENT_SECRET = "";
    expect(() => mintGrant({ userId: "u", projectId: "p" })).toThrow(
      /IMAGE_STUDIO_AGENT_SECRET/,
    );
  });
});
