import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getEnv: () => ({ BETTER_AUTH_SECRET: "test-secret-for-turn-tokens" }),
}));

import { issueTurnToken, verifyTurnToken } from "./turn-token";

const TURN = "01960001-0001-7001-8001-000000000001";
const hostNow = async () => Date.now();

describe("turn tokens", () => {
  it("round-trips for the turn it names", async () => {
    const expiresAt = Date.now() + 60_000;
    const token = issueTurnToken({
      turnId: TURN,
      sessionId: "sess_1",
      reconciliationLeaseToken: "launch-lease",
      expiresAt,
    });
    await expect(verifyTurnToken(token, TURN, hostNow)).resolves.toEqual({
      turnId: TURN,
      sessionId: "sess_1",
      reconciliationLeaseToken: "launch-lease",
      expiresAt,
    });
  });

  it("refuses an expired token by the clock it is given", async () => {
    const token = issueTurnToken({
      turnId: TURN,
      sessionId: "s",
      expiresAt: 1_000,
    });
    await expect(
      verifyTurnToken(token, TURN, async () => 999),
    ).resolves.toBeTruthy();
    await expect(
      verifyTurnToken(token, TURN, async () => 1_000),
    ).resolves.toBeNull();
  });

  it("refuses another turn and a tampered or missing token without reading the clock", async () => {
    const token = issueTurnToken({
      turnId: TURN,
      sessionId: "sess_1",
      expiresAt: Date.now() + 60_000,
    });
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        turnId: TURN,
        sessionId: "evil",
        expiresAt: Date.now() + 1e9,
      }),
    ).toString("base64url");
    // A clock that is down: rejected credentials must never need it.
    const now = vi.fn(async (): Promise<number> => {
      throw new Error("Database unavailable");
    });

    for (const [candidate, turnId] of [
      [token, "another-turn"],
      [`${forged}.${signature}`, TURN],
      [`${payload}.`, TURN],
      [undefined, TURN],
    ] as const) {
      await expect(verifyTurnToken(candidate, turnId, now)).resolves.toBeNull();
    }
    expect(now).not.toHaveBeenCalled();
  });
});
