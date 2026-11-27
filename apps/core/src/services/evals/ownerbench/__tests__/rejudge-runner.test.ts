import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("local rejudge and plan adapter selection (unmocked env)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("ordinary local plan runs configure the in-process adapter before Core caches env", async () => {
    vi.resetModules();
    vi.stubEnv("SOKO_BOT_LOCAL_CHATGPT_PLAN", "1");
    vi.stubEnv("SOKO_BOT_PLAN_REAL_JEV", "1");
    vi.stubEnv("SOKO_BOT_RUNTIME_ADAPTER", undefined);
    vi.stubEnv("SOKO_BOT_EVALUATION_ALLOWANCE", undefined);
    vi.stubEnv("OWNERBENCH_HOLDOUT_FILE", undefined);
    vi.stubEnv("OWNERBENCH_SPLITS_FILE", undefined);
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://localhost/sokosumi_codex_harness_review",
    );

    // Importing per-item-judge must not eagerly cache getEnv() ahead of adapter setup.
    const { ownerbenchJudgeMode } = await import("../per-item-judge");
    expect(ownerbenchJudgeMode()).toBe("holistic");
    process.env.SOKO_BOT_RUNTIME_ADAPTER = "in-process";
    const { effectiveSokoBotRuntimeAdapter } = await import(
      "@/lib/soko-bot/factory"
    );
    expect(effectiveSokoBotRuntimeAdapter()).toBe("in-process");

    // evals-local.mts must also set in-process before importing per-item-judge on ordinary runs.
    const cliSource = readFileSync(
      resolve(process.cwd(), "scripts/evals-local.mts"),
      "utf8",
    );
    const adapterIndex = cliSource.indexOf(
      'process.env.SOKO_BOT_RUNTIME_ADAPTER = "in-process";',
    );
    const ordinaryJudgeImportIndex = cliSource.indexOf(
      "const { ownerbenchJudgeMode } = await import(",
    );
    expect(adapterIndex).toBeGreaterThan(-1);
    expect(ordinaryJudgeImportIndex).toBeGreaterThan(adapterIndex);
  });

  it("selects claude-code even if env was cached before setting SOKO_BOT_JUDGE_RUNNER", async () => {
    vi.resetModules();
    vi.stubEnv("SOKO_BOT_JUDGE_RUNNER", undefined);
    vi.stubEnv("SOKO_BOT_LOCAL_CHATGPT_PLAN", undefined);
    vi.stubEnv("OWNERBENCH_HOLDOUT_FILE", undefined);
    vi.stubEnv("OWNERBENCH_SPLITS_FILE", undefined);
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://localhost/sokosumi_codex_harness_review",
    );

    const { ownerbenchJudgeMode } = await import("../per-item-judge");
    expect(ownerbenchJudgeMode("per-item")).toBe("per-item");

    process.env.SOKO_BOT_JUDGE_RUNNER = "claude-code";
    const { sokoBotJudgeRunner } = await import(
      "@/services/soko-bot-lab-judge.service"
    );
    expect(sokoBotJudgeRunner()).toBe("claude-code");
  });

  it("fails closed in rejudgeEvalRunReport if runner resolves to gateway", async () => {
    vi.resetModules();
    vi.stubEnv("SOKO_BOT_JUDGE_RUNNER", "gateway");
    vi.stubEnv("SOKO_BOT_LOCAL_CHATGPT_PLAN", undefined);
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://localhost/sokosumi_codex_harness_review",
    );

    const { OWNER_JOURNEYS } = await import("../journeys");
    const { rejudgeEvalRunReport } = await import("../per-item-judge");
    const devJourney = OWNER_JOURNEYS[2]!;
    await expect(
      rejudgeEvalRunReport({
        report: {
          run: { id: "run-gw" },
          cases: [
            {
              caseId: devJourney.id,
              states: ["PASSED"],
              passRate: 1,
              results: [
                {
                  id: "r1",
                  caseId: devJourney.id,
                  repeat: 1,
                  status: "PASSED",
                  turnId: "t1",
                  checks: [{ pass: true }],
                  judge: { verdict: "pass" },
                  judgeModel: "old",
                  output: {
                    steps: [{ kind: "owner", label: "ask", turnIds: ["t1"] }],
                  },
                  error: null,
                  durationMs: 50,
                },
              ],
            },
          ],
        },
        journeys: [devJourney],
      }),
    ).rejects.toThrow("refuses the paid AI Gateway");
  });
});
