import { afterEach, describe, expect, it, vi } from "vitest";
import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";
import { expectCoreLog } from "@/test/core-log";
import { reportAiGatewayBudgetFailure } from "./ai-gateway-budget";

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
    const time = vi.spyOn(Date, "now").mockReturnValue(3_600_000);

    await Promise.all([
      reportAiGatewayBudgetFailure("key", "soko-bot", "shared"),
      reportAiGatewayBudgetFailure("key", "cmo", "shared"),
    ]);
    expect(errors).toHaveLength(1);
    await reportAiGatewayBudgetFailure("key", "cmo", "other-key");
    await reportAiGatewayBudgetFailure("team", "soko-bot", "shared");
    await reportAiGatewayBudgetFailure("team", "cmo", "other-key");
    expect(errors).toHaveLength(3);

    time.mockReturnValue(7_199_999);
    await reportAiGatewayBudgetFailure("key", "soko-bot", "shared");
    expect(errors).toHaveLength(3);

    time.mockReturnValue(7_200_000);
    await reportAiGatewayBudgetFailure("key", "soko-bot", "shared");
  });
});
