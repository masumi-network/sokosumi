import { describe, expect, it } from "vitest";

import {
  mintAgentGrant,
  verifyAgentGrant,
} from "@/lib/image-studio/agent-grant";

const SECRET = "a".repeat(48);
const OTHER_SECRET = "b".repeat(48);
const NOW = new Date("2026-09-25T12:00:00.000Z");

describe("image studio agent grant", () => {
  it("round-trips the acting user and project", () => {
    const token = mintAgentGrant(
      { userId: "user-1", projectId: "project-1", now: NOW },
      SECRET,
    );
    const result = verifyAgentGrant(token, SECRET, NOW);
    expect(result.ok).toBe(true);
    expect(result.ok && result.claims.userId).toBe("user-1");
    expect(result.ok && result.claims.projectId).toBe("project-1");
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintAgentGrant(
      { userId: "user-1", projectId: "project-1", now: NOW },
      OTHER_SECRET,
    );
    expect(verifyAgentGrant(token, SECRET, NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("rejects a token whose project was edited after minting", () => {
    const token = mintAgentGrant(
      { userId: "user-1", projectId: "project-1", now: NOW },
      SECRET,
    );
    const swapped = token.replace("project-1", "project-2");
    expect(verifyAgentGrant(swapped, SECRET, NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("expires", () => {
    const token = mintAgentGrant(
      { userId: "user-1", projectId: "project-1", ttlSeconds: 60, now: NOW },
      SECRET,
    );
    const later = new Date(NOW.getTime() + 61_000);
    expect(verifyAgentGrant(token, SECRET, later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("caps the lifetime a caller can ask for", () => {
    const token = mintAgentGrant(
      {
        userId: "user-1",
        projectId: "project-1",
        ttlSeconds: 86_400,
        now: NOW,
      },
      SECRET,
    );
    const wayLater = new Date(NOW.getTime() + 601_000);
    expect(verifyAgentGrant(token, SECRET, wayLater)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a malformed token", () => {
    expect(verifyAgentGrant("nonsense", SECRET, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
