import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectCoreLogWhys } from "@/test/core-log";

const JEV = "https://ai-gateway.vercel.sh/v4/ai/decision-model";

beforeEach(() => {
  vi.stubEnv("SOKO_BOT_LOCAL_CHATGPT_PLAN", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("plan runs with real Jev", () => {
  it("lets only Jev's decision model through the Gateway guard", async () => {
    vi.stubEnv("SOKO_BOT_PLAN_REAL_JEV", "1");
    const send = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", send);
    const { ChatGptPlanGatewayCallError } = await import(
      "./local-chatgpt-plan"
    );
    await fetch(JEV, {
      method: "POST",
      headers: { "ai-model-id": "typesafe-ai/jev" },
    });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(
      fetch(JEV, { headers: { "ai-model-id": "google/gemini-3.8-flash" } }),
    ).rejects.toBeInstanceOf(ChatGptPlanGatewayCallError);
    await expect(
      fetch("https://ai-gateway.vercel.sh/v4/ai/language-model", {
        headers: { "ai-model-id": "typesafe-ai/jev" },
      }),
    ).rejects.toBeInstanceOf(ChatGptPlanGatewayCallError);
    await expect(
      fetch(
        new Request("https://ai-gateway.vercel.sh/v4/ai/language-model", {
          headers: { "ai-model-id": "openai/gpt-6.2-sol" },
        }),
      ),
    ).rejects.toBeInstanceOf(ChatGptPlanGatewayCallError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps Jev on the stand-in without the opt-in", async () => {
    const send = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", send);
    const { ChatGptPlanGatewayCallError } = await import(
      "./local-chatgpt-plan"
    );
    await expect(
      fetch(JEV, { headers: { "ai-model-id": "typesafe-ai/jev" } }),
    ).rejects.toBeInstanceOf(ChatGptPlanGatewayCallError);
    const { planJevMode, planUsesJevStandIn } = await import("./plan-jev");
    expect(planJevMode()).toBe("stand-in");
    expect(planUsesJevStandIn()).toBe(true);
  });

  it("labels the run's environment as real Jev, apart from stand-in runs", async () => {
    vi.stubEnv("SOKO_BOT_PLAN_REAL_JEV", "1");
    const { evalEnvironment, comparableRuns } = await import(
      "./evals/eval-environment"
    );
    expect(evalEnvironment()).toBe("local-chatgpt-plan-real-jev");
    expect(
      comparableRuns({
        environment: "local-chatgpt-plan-real-jev",
        label: null,
      }),
    ).toEqual({ environment: "local-chatgpt-plan-real-jev" });
  });

  it("uses Jev's own timeouts with real Jev and the stand-in's otherwise", async () => {
    const { classifierAttemptTimeoutMs } = await import(
      "./soko-bot/classifier"
    );
    const { organizerJevTimeoutMs } = await import(
      "@/services/cmo-context-organizer"
    );
    const real = {
      ...process.env,
      SOKO_BOT_LOCAL_CHATGPT_PLAN: "1",
      SOKO_BOT_PLAN_REAL_JEV: "1",
    };
    const standIn = { ...process.env, SOKO_BOT_LOCAL_CHATGPT_PLAN: "1" };
    expect(classifierAttemptTimeoutMs(real)).toBe(3_500);
    expect(classifierAttemptTimeoutMs(standIn)).toBe(45_000);
    expect(organizerJevTimeoutMs(real)).toBe(4_000);
    expect(organizerJevTimeoutMs(standIn)).toBe(45_000);
  });

  it("falls back to the stand-in for 30 min when real Jev fails, then retries it", async () => {
    vi.stubEnv("SOKO_BOT_PLAN_REAL_JEV", "1");
    expectCoreLogWhys(
      "warn",
      "Real Jev paused for 30 min (2 of 11 recent calls failed)",
      ["Real Jev failed too often on this ChatGPT plan run"],
    );
    const jev = await import("./plan-jev");
    const start = Date.parse("2026-11-26T15:00:00Z");
    expect(jev.planJevMode(start)).toBe("real");
    for (let call = 0; call < 9; call += 1)
      jev.recordRealJevCall({ ok: true, costUsd: 0.001 }, start);
    jev.recordRealJevCall({ ok: false, error: new Error("timeout") }, start);
    // 1 of 10 failed: not above a tenth.
    expect(jev.planJevMode(start)).toBe("real");
    jev.recordRealJevCall({ ok: false, error: new Error("timeout") }, start);
    expect(jev.planJevMode(start + 1_000)).toBe("stand-in");
    expect(jev.planUsesJevStandIn(process.env, start + 1_000)).toBe(true);
    expect(
      jev.planJevStandInDuring(
        new Date(start + 60_000),
        new Date(start + 120_000),
      ),
    ).toBe(true);
    const back = start + jev.PLAN_JEV_PAUSE_MS + 1;
    expect(jev.planJevMode(back)).toBe("real");
    expect(
      jev.planJevStandInDuring(new Date(back), new Date(back + 60_000)),
    ).toBe(false);
    const stats = jev.planJevStats();
    expect(stats.calls).toBe(11);
    expect(stats.failures).toBe(2);
    expect(stats.costUsd).toBeCloseTo(0.009);
    expect(stats.standInWindows).toHaveLength(1);
  });

  it("falls back at once when the Gateway budget stops real Jev", async () => {
    vi.stubEnv("SOKO_BOT_PLAN_REAL_JEV", "1");
    expectCoreLogWhys(
      "warn",
      "Real Jev paused for 30 min (the Gateway budget stopped it)",
      ["Real Jev failed too often on this ChatGPT plan run"],
    );
    const jev = await import("./plan-jev");
    const { AiGatewayBudgetError } = await import("./ai-gateway-budget");
    jev.recordRealJevCall({ ok: false, error: new AiGatewayBudgetError() });
    expect(jev.planJevMode()).toBe("stand-in");
  });
});
