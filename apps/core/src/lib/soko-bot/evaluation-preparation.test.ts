import { getSokoBotVersion } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import {
  createSokoBotCandidate,
  SokoBotEvaluationBudget,
  sokoBotEvaluationCasesSchema,
} from "./evaluation-preparation";

describe("offline evaluation preparation", () => {
  it("materializes an immutable reproducible candidate without promoting it", () => {
    const base = getSokoBotVersion("v16");
    const candidate = createSokoBotCandidate(base, "google/gemini-3.8-flash");
    expect(candidate).toEqual(
      createSokoBotCandidate(base, "google/gemini-3.8-flash"),
    );
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(candidate.capabilities.length).toBeGreaterThan(0);
    expect(candidate.capabilities).toContain("archive_task");
    expect(candidate.systemPrompt).toContain("Archiving: when the owner asks");
    expect(candidate.systemPrompt).toContain("exact updatedAt");
    expect(candidate.systemPrompt).toContain(
      "Ask in chat only when it is unclear which Tasks they mean",
    );
    expect(candidate.systemPrompt).not.toContain("request_user_decision");
    expect(base.systemPrompt).not.toContain("Archiving: when the owner asks");
    expect(Object.isFrozen(candidate.capabilities)).toBe(true);
    expect(candidate.id).not.toBe(
      createSokoBotCandidate(
        { ...base, systemPrompt: `${base.systemPrompt} changed` },
        candidate.model,
      ).id,
    );
    expect(base.model).toBe("google/gemini-3.6-flash");
  });
  it("does not widen a restricted candidate's archival authority", () => {
    const candidate = createSokoBotCandidate(
      { ...getSokoBotVersion("v16"), capabilities: ["get_task_status"] },
      "google/gemini-3.8-flash",
    );
    expect(candidate.capabilities).toEqual(["get_task_status"]);
    expect(candidate.systemPrompt).not.toContain(
      "Archiving: when the owner asks",
    );
  });
  it("rejects identifiers, links, extra fields and conversation split leakage", () => {
    const item = {
      id: "case-one",
      conversation: "conversation-one",
      split: "development",
      sanitized: true,
      message: "Do the synthetic action",
      expected: "Ask for approval",
    };
    expect(sokoBotEvaluationCasesSchema.safeParse([item]).success).toBe(true);
    for (const change of [
      { message: "alice@example.com" },
      { message: "https://private.example" },
      { turnId: "retained-turn" },
    ]) {
      expect(
        sokoBotEvaluationCasesSchema.safeParse([{ ...item, ...change }])
          .success,
      ).toBe(false);
    }
    expect(
      sokoBotEvaluationCasesSchema.safeParse([
        item,
        { ...item, id: "case-two", split: "held-out" },
      ]).success,
    ).toBe(false);
  });
  it("reserves before dispatch, retains unknown costs, and rejects exhausted budgets", () => {
    const budget = new SokoBotEvaluationBudget();
    const request = budget.reserve({
      inputTokens: 8192,
      outputTokens: 2048,
      maximumCostUsd: 10,
    });
    budget.settle(request, null);
    expect(budget.totalUsd).toBe(10);
    expect(() =>
      budget.reserve({ inputTokens: 1, outputTokens: 1, maximumCostUsd: 0.01 }),
    ).toThrow();
    budget.settle(request, 1);
    expect(budget.totalUsd).toBe(1);
    expect(() => budget.settle(request, 1)).toThrow();
    expect(() =>
      budget.reserve({
        inputTokens: 8193,
        outputTokens: 1,
        maximumCostUsd: 0.01,
      }),
    ).toThrow();
  });
  it("stops dispatch when actual spend exceeds the reserved price", () => {
    const budget = new SokoBotEvaluationBudget();
    const request = budget.reserve({
      inputTokens: 1,
      outputTokens: 1,
      maximumCostUsd: 0.01,
    });
    expect(() => budget.settle(request, 0.02)).toThrow();
    expect(budget.totalUsd).toBe(0.02);
    expect(() =>
      budget.reserve({ inputTokens: 1, outputTokens: 1, maximumCostUsd: 0.01 }),
    ).toThrow();
  });
});
