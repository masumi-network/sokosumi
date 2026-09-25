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
function coreVerify(token: string, secret: string, now = new Date()) {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const [, userId, projectId, expiresAtRaw, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = crypto
    .createHmac("sha256", secret)
    .update(["v1", userId, projectId, expiresAtRaw].join("."))
    .digest("base64url");
  if (expected !== signature) return null;
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
    const payload = ["v1", "user-1", "project-1", String(expiresAt)].join(".");
    const webToken = `${payload}.${crypto
      .createHmac("sha256", SECRET)
      .update(payload)
      .digest("base64url")}`;

    expect(verifyGrant(webToken)).toEqual({
      userId: "user-1",
      projectId: "project-1",
    });
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
