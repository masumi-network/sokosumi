import type { CmoBrandBrain, CmoStrategy } from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

// A plain function, not a spy: a spy reports the rejection the code handles.
const jev = vi.hoisted(() => ({
  answer: (): Promise<unknown> => Promise.resolve(undefined),
}));
vi.mock("@/lib/soko-bot/jev", () => ({
  evaluateWithJev: () => jev.answer(),
}));

import { cmoPlanDrift, cmoPlanProblems } from "./cmo-plan-review.service";

const entry = (id: string, channel: string, format: string) => ({
  id,
  date: "2026-11-02",
  channel,
  format,
  title: "A piece",
  status: "idea" as const,
});

const plan = (patch: Partial<CmoStrategy> = {}): CmoStrategy =>
  ({
    month: "2026-11",
    summary: "Show teams how custom AI CoWorkers fit their work.",
    goals: ["More intro calls"],
    pillars: ["Recurring work"],
    channels: [],
    calendar: [],
    mix: [{ approach: "educational", share: 100, why: "Teach" }],
    funnel: [
      {
        stage: "awareness",
        name: "Hear",
        goal: "g",
        channels: [],
        metric: "Visits",
      },
      {
        stage: "consideration",
        name: "Look",
        goal: "g",
        channels: [],
        metric: "Page views",
      },
      {
        stage: "conversion",
        name: "Call",
        goal: "g",
        channels: [],
        metric: "Intro calls",
      },
    ],
    objective: { metric: "Intro calls", target: "8 by 23 Nov" },
    proposals: [],
    previews: [],
    changes: [],
    openQuestions: [],
    ...patch,
  }) as CmoStrategy;

describe("cmoPlanProblems", () => {
  it("passes a plan that keeps the skill's hard rules", () => {
    expect(cmoPlanProblems(plan())).toEqual([]);
  });

  it("names each broken rule so Cuso can fix it", () => {
    const problems = cmoPlanProblems(
      plan({
        mix: [],
        funnel: [
          {
            stage: "conversion",
            name: "Call",
            goal: "g",
            channels: [],
            metric: "Demos",
          },
        ],
        calendar: [
          { ...entry("a", "linkedin", "post"), draft: "Written already" },
        ],
      }),
    );
    expect(problems.join("\n")).toMatch(/mix is empty/);
    expect(problems.join("\n")).toMatch(/funnel has 1 stages/);
    expect(problems.join("\n")).toMatch(/objective's metric, "Intro calls"/);
    expect(problems.join("\n")).toMatch(/calendar has 1 pieces/);
    expect(problems.join("\n")).toMatch(/uses 1 formats/);
    expect(problems.join("\n")).toMatch(/holds drafts/);
  });
});

describe("cmoPlanDrift", () => {
  const brain = {
    summary: "utxo AG builds custom AI CoWorkers.",
    products: ["Custom AI CoWorkers", "Lead research CoWorker"],
    reveal: { positioning: "Custom AI CoWorkers for business processes" },
  } as unknown as CmoBrandBrain;

  it("flags a plan the evaluator says sells a side product", async () => {
    jev.answer = async () => ({
      answers: new Map([
        ["sellsMainOffer", { type: "boolean", probability: 0.1 }],
      ]),
      costUsd: 0.0004,
    });
    const drift = await cmoPlanDrift({
      strategy: plan(),
      brain,
      goals: "More leads",
    });
    expect(drift.problem).toMatch(/drifts from the main offer/);
    expect(drift.costUsd).toBe(0.0004);
  });

  it("lets a plan on the main offer through", async () => {
    jev.answer = async () => ({
      answers: new Map([
        ["sellsMainOffer", { type: "boolean", probability: 0.92 }],
      ]),
      costUsd: 0.0004,
    });
    expect(
      (await cmoPlanDrift({ strategy: plan(), brain, goals: "More leads" }))
        .problem,
    ).toBeNull();
  });

  it("never blocks the save when the evaluator fails", async () => {
    jev.answer = async () => {
      throw new TypeError("fetch failed");
    };
    expect(
      await cmoPlanDrift({ strategy: plan(), brain, goals: "More leads" }),
    ).toEqual({
      problem: null,
      costUsd: 0,
    });
  });
});
