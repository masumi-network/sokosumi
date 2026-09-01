import { describe, expect, it } from "vitest";

import {
  generateOrchestratorApiKeyToken,
  ORCHESTRATOR_API_KEY_PREFIX,
  ORCHESTRATOR_API_KEY_START_LENGTH,
} from "./orchestrator-api-key";

describe("orchestrator-api-key", () => {
  it("mints tokens with the orchestrator_ prefix, not orch_", () => {
    const token = generateOrchestratorApiKeyToken();
    expect(token.startsWith(ORCHESTRATOR_API_KEY_PREFIX)).toBe(true);
    expect(token.startsWith("orch_")).toBe(false);
    expect(token.slice(0, ORCHESTRATOR_API_KEY_START_LENGTH).length).toBe(
      ORCHESTRATOR_API_KEY_START_LENGTH,
    );
  });
});
