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
      { userId: "user-1", projectId: "project-1", audience: "agent", now: NOW },
      SECRET,
    );
    const result = verifyAgentGrant(token, SECRET, "agent", NOW);
    expect(result.ok).toBe(true);
    expect(result.ok && result.claims.userId).toBe("user-1");
    expect(result.ok && result.claims.projectId).toBe("project-1");
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintAgentGrant(
      { userId: "user-1", projectId: "project-1", audience: "agent", now: NOW },
      OTHER_SECRET,
    );
    expect(verifyAgentGrant(token, SECRET, "agent", NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("rejects a token whose project was edited after minting", () => {
    const token = mintAgentGrant(
      { userId: "user-1", projectId: "project-1", audience: "agent", now: NOW },
      SECRET,
    );
    const swapped = token.replace("project-1", "project-2");
    expect(verifyAgentGrant(swapped, SECRET, "agent", NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("expires", () => {
    const token = mintAgentGrant(
      {
        userId: "user-1",
        projectId: "project-1",
        audience: "agent",
        ttlSeconds: 60,
        now: NOW,
      },
      SECRET,
    );
    const later = new Date(NOW.getTime() + 61_000);
    expect(verifyAgentGrant(token, SECRET, "agent", later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("caps the lifetime a caller can ask for", () => {
    const token = mintAgentGrant(
      {
        userId: "user-1",
        projectId: "project-1",
        audience: "agent",
        ttlSeconds: 86_400,
        now: NOW,
      },
      SECRET,
    );
    const wayLater = new Date(NOW.getTime() + 601_000);
    expect(verifyAgentGrant(token, SECRET, "agent", wayLater)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a malformed token", () => {
    expect(verifyAgentGrant("nonsense", SECRET, "agent", NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

it("refuses a browser token at the agent surface, and the reverse", () => {
  // Same secret, same format. Without the audience the page's token was a
  // working credential for Core's agent surface.
  const browserToken = mintAgentGrant(
    { userId: "user-1", projectId: "project-1", audience: "browser" },
    SECRET,
  );
  expect(verifyAgentGrant(browserToken, SECRET, "agent")).toEqual({
    ok: false,
    reason: "audience",
  });

  const agentToken = mintAgentGrant(
    { userId: "user-1", projectId: "project-1", audience: "agent" },
    SECRET,
  );
  expect(verifyAgentGrant(agentToken, SECRET, "browser")).toEqual({
    ok: false,
    reason: "audience",
  });
  expect(verifyAgentGrant(agentToken, SECRET, "agent").ok).toBe(true);
});
