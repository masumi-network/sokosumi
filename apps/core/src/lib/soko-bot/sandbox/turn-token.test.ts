import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getEnv: () => ({ BETTER_AUTH_SECRET: "test-secret-for-turn-tokens" }),
}));

import { issueTurnToken, verifyTurnToken } from "./turn-token";

const TURN = "01960001-0001-7001-8001-000000000001";

describe("turn tokens", () => {
  it("round-trips for the turn it names", () => {
    const expiresAt = Date.now() + 60_000;
    const token = issueTurnToken({
      turnId: TURN,
      sessionId: "sess_1",
      expiresAt,
    });
    expect(verifyTurnToken(token, TURN)).toEqual({
      turnId: TURN,
      sessionId: "sess_1",
      expiresAt,
    });
  });

  it("refuses another turn, an expired token and a tampered one", () => {
    const token = issueTurnToken({
      turnId: TURN,
      sessionId: "sess_1",
      expiresAt: Date.now() + 60_000,
    });
    expect(verifyTurnToken(token, "another-turn")).toBeNull();
    expect(
      verifyTurnToken(
        issueTurnToken({
          turnId: TURN,
          sessionId: "s",
          expiresAt: Date.now() - 1,
        }),
        TURN,
      ),
    ).toBeNull();
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        turnId: TURN,
        sessionId: "evil",
        expiresAt: Date.now() + 1e9,
      }),
    ).toString("base64url");
    expect(verifyTurnToken(`${forged}.${signature}`, TURN)).toBeNull();
    expect(verifyTurnToken(`${payload}.`, TURN)).toBeNull();
    expect(verifyTurnToken(undefined, TURN)).toBeNull();
  });
});
