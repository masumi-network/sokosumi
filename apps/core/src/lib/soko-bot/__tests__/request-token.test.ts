import { describe, expect, it } from "vitest";

import { SokoBotTokenService } from "../request-token";

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIEtAHIe/imf5Y2MGlER9BMAfL6LUipRTXorzq1h/e5eZ
-----END PRIVATE KEY-----`;

describe("Soko Bot request and turn grants", () => {
  it("binds request and grant to exact turn scope", async () => {
    const now = new Date();
    const tokens = await SokoBotTokenService.create({
      issuer: "https://core.example.test",
      requestAudience: "soko-bot-runtime",
      grantAudience: "soko-bot-core",
      currentKeyId: "test-1",
      privateKeyPem: PRIVATE_KEY,
    });
    const scope = {
      userId: "user-1",
      sokoBotId: "bot-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      turnId: "turn-1",
      now,
    };
    const requestToken = await tokens.signRequestToken(scope);
    const turnGrant = await tokens.signTurnGrant({
      ...scope,
      contextSnapshotId: "context-1",
      memoryRevisionId: "memory-1",
      memoryVersion: 2,
      capabilities: ["create_task"],
      deadlineAt: new Date(now.getTime() + 15 * 60 * 1_000),
    });

    expect((await tokens.verifyRequestToken(requestToken)).turnId).toBe(
      "turn-1",
    );
    expect((await tokens.verifyTurnGrant(turnGrant)).capabilities).toEqual([
      "create_task",
    ]);
  });
});
