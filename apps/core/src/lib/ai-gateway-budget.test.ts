import { RetryError } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";
import { expectCoreLog } from "@/test/core-log";
import {
  reportAiGatewayBudgetFailure,
  reportAiGatewayBudgetResponse,
  rethrowAiGatewayFailure,
} from "./ai-gateway-budget";

vi.mock("@/lib/redis-rate-limit", () => ({
  incrementRedisRateLimit: vi.fn(),
}));

const increment = vi.mocked(incrementRedisRateLimit);
const message = "AI Gateway budget exhausted";

afterEach(() => {
  increment.mockReset();
  vi.restoreAllMocks();
});

describe("AI Gateway budget alerts", () => {
  it("shares the team alert across SDK and direct HTTP callers", async () => {
    const alerts = expectCoreLog("error", message);
    expectCoreLog("warn", message);
    increment.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const refusal = Object.assign(
      new Error("Team budget exceeded for private-team-name"),
      {
        name: "GatewayInternalServerError",
      },
    );
    const sdkError = new RetryError({
      message: "Model call failed",
      reason: "maxRetriesExceeded",
      errors: [refusal],
    });

    await expect(rethrowAiGatewayFailure(sdkError)).rejects.toMatchObject({
      code: "ai_budget_exceeded",
    });
    await expect(
      reportAiGatewayBudgetResponse(
        Response.json(
          {
            error: {
              type: "quota_for_entity_exceeded",
              message: refusal.message,
            },
          },
          { status: 429 },
        ),
        "another-key",
      ),
    ).resolves.toBe("ai_budget_exceeded");
    expect(increment.mock.calls).toEqual([
      ["ai-gateway:budget-alert:team", 3600],
      ["ai-gateway:budget-alert:team", 3600],
    ]);
    expect(JSON.stringify(alerts)).not.toContain("private-team-name");
  });

  it("preserves unrelated SDK and HTTP failures", async () => {
    const failure = Object.assign(new Error("Provider unavailable"), {
      name: "GatewayInternalServerError",
    });
    await expect(rethrowAiGatewayFailure(failure)).rejects.toBe(failure);
    await expect(
      reportAiGatewayBudgetResponse(
        new Response("Provider unavailable", { status: 502 }),
        undefined,
      ),
    ).resolves.toBeUndefined();
    expect(increment).not.toHaveBeenCalled();
  });

  it("logs an error for a new Redis claim", async () => {
    expectCoreLog("error", message);
    expectCoreLog("warn", message);
    increment.mockResolvedValueOnce(1).mockResolvedValueOnce(undefined);

    await reportAiGatewayBudgetFailure("key", "soko-bot", "redis-new");
    await reportAiGatewayBudgetFailure("key", "cmo", "redis-new");
  });

  it("logs a warning when the shared window is already claimed", async () => {
    expectCoreLog("warn", message);
    increment.mockResolvedValueOnce(2);

    await reportAiGatewayBudgetFailure("key", "cmo", "redis-claimed");
  });

  it("claims each scope once per instance per hour when Redis is unavailable", async () => {
    const errors = expectCoreLog("error", message, 4);
    expectCoreLog("warn", message, 3);
    increment.mockResolvedValue(undefined);
    const startedAt = Date.now() + 3_600_000;
    const time = vi.spyOn(Date, "now").mockReturnValue(startedAt);

    await Promise.all([
      reportAiGatewayBudgetFailure("key", "soko-bot", "shared"),
      reportAiGatewayBudgetFailure("key", "cmo", "shared"),
    ]);
    expect(errors).toHaveLength(1);
    await reportAiGatewayBudgetFailure("key", "cmo", "other-key");
    await reportAiGatewayBudgetFailure("team", "soko-bot", "shared");
    await reportAiGatewayBudgetFailure("team", "cmo", "other-key");
    expect(errors).toHaveLength(3);

    time.mockReturnValue(startedAt + 3_599_999);
    await reportAiGatewayBudgetFailure("key", "soko-bot", "shared");
    expect(errors).toHaveLength(3);

    time.mockReturnValue(startedAt + 3_600_000);
    await reportAiGatewayBudgetFailure("key", "soko-bot", "shared");
  });
});
