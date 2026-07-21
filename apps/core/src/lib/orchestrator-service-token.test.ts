import { afterEach, describe, expect, it, vi } from "vitest";

const getEnvMock = vi.hoisted(() => vi.fn());

vi.mock("@/config/env", () => ({
  getEnv: () => getEnvMock(),
}));

import { isOrchestratorServiceToken } from "./orchestrator-service-token";

describe("isOrchestratorServiceToken", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts the exact service token", () => {
    getEnvMock.mockReturnValue({
      ORCHESTRATOR_SERVICE_TOKEN: "test-orchestrator-service-token",
    });
    expect(isOrchestratorServiceToken("test-orchestrator-service-token")).toBe(
      true,
    );
  });

  it("rejects a wrong token", () => {
    getEnvMock.mockReturnValue({
      ORCHESTRATOR_SERVICE_TOKEN: "test-orchestrator-service-token",
    });
    expect(isOrchestratorServiceToken("wrong-token")).toBe(false);
  });

  it("rejects empty token when secret is non-empty", () => {
    getEnvMock.mockReturnValue({
      ORCHESTRATOR_SERVICE_TOKEN: "test-orchestrator-service-token",
    });
    expect(isOrchestratorServiceToken("")).toBe(false);
  });
});
