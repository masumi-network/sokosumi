import { describe, expect, it } from "vitest";

import {
  createOrchestratorApiKeyResponseSchema,
  orchestratorApiKeySchema,
} from "./orchestrator-api-key.schema";

describe("orchestrator API key response schemas", () => {
  it("requires the orchestrator owner", () => {
    const metadata = {
      id: "agentkey_123",
      name: null,
      keyStart: "orchestrator_abcdefgh",
      expiresAt: null,
      revokedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      orchestratorApiKeySchema.safeParse({
        ...metadata,
        orchestratorId: "01960001-0001-7001-8001-000000000099",
      }).success,
    ).toBe(true);
    expect(orchestratorApiKeySchema.safeParse(metadata).success).toBe(false);
  });

  it("requires name and id in create responses", () => {
    expect(
      createOrchestratorApiKeyResponseSchema.safeParse({
        id: "agentkey_123",
        token: "orchestrator_secret",
        name: null,
        expiresAt: null,
      }).success,
    ).toBe(true);
    expect(
      createOrchestratorApiKeyResponseSchema.safeParse({
        token: "orchestrator_secret",
        expiresAt: null,
      }).success,
    ).toBe(false);
  });
});
