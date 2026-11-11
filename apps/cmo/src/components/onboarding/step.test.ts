import type { CmoOverview } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  cmoOverview,
  cmoStrategy,
  cmoStrategyVersion,
} from "../../test-fixtures/cmo";
import { onboardingStep, planUnfitted } from "./step";

type Work = NonNullable<CmoOverview["work"]>;

const running = (kind: Work["kind"], status: Work["status"] = "running") => ({
  kind,
  status,
  startedAt: new Date("2026-10-05T09:00:00Z"),
  steps: [],
  sections: [],
  sectionsSaved: 0,
  sectionsTotal: 16,
});

const brain = cmoOverview().brandBrain as NonNullable<
  CmoOverview["brandBrain"]
>;
const question = (answer?: "yes" | "no" | "unsure") => ({
  id: `q-${answer ?? "open"}`,
  question: "Is the trial your main offer?",
  statement: "The trial is the main offer",
  section: "offer" as const,
  ...(answer ? { answer } : {}),
});
const confirmed = new Date("2026-10-05T09:05:00Z");
/** A saved Brand Brain nobody confirmed yet, no plan. */
const saved = (patch: Partial<CmoOverview> = {}) =>
  cmoOverview({ strategy: null, brandBrainConfirmedAt: null, ...patch });
/** A first plan, whole, that the founder has not approved. */
const draft = (patch: Partial<CmoOverview> = {}) =>
  cmoOverview({
    brandBrainConfirmedAt: confirmed,
    strategy: { ...cmoStrategy, changes: [] },
    ...patch,
  });

describe("onboardingStep", () => {
  it("reads the site until Cuso saves a Brand Brain", () => {
    expect(
      onboardingStep(
        cmoOverview({ brandBrain: null, strategy: null, learning: "running" }),
      ),
    ).toEqual({ step: "site", phase: "reading" });
  });

  it("fails the read once it ended without a Brand Brain", () => {
    expect(
      onboardingStep(cmoOverview({ brandBrain: null, strategy: null })).phase,
    ).toBe("failed");
    expect(
      onboardingStep(
        cmoOverview({
          brandBrain: null,
          strategy: null,
          learning: "running",
          work: running("research", "done"),
        }),
      ).phase,
    ).toBe("failed");
  });

  it("fails the read when learning failed", () => {
    expect(
      onboardingStep(
        cmoOverview({ brandBrain: null, strategy: null, learning: "failed" }),
      ),
    ).toEqual({ step: "site", phase: "failed" });
  });

  it("keeps reading while research runs after the Brand Brain is saved", () => {
    expect(onboardingStep(saved({ work: running("research") }))).toEqual({
      step: "site",
      phase: "reading",
    });
  });

  it("asks the unanswered questions before the Brand step", () => {
    const withQuestions = saved({
      brandBrain: { ...brain, questions: [question("yes"), question()] },
    });
    expect(onboardingStep(withQuestions)).toEqual({
      step: "site",
      phase: "asking",
    });
  });

  it("asks still-open questions of a Brand Brain confirmed before they moved to Site", () => {
    const legacy = saved({
      brandBrainConfirmedAt: confirmed,
      brandBrain: { ...brain, questions: [question()] },
    });
    expect(onboardingStep(legacy)).toEqual({ step: "site", phase: "asking" });
    // Answered or skipped, it goes on to ask for the plan.
    expect(onboardingStep(legacy, ["questions"])).toEqual({
      step: "plan",
      phase: "writing-needed",
    });
  });

  it("goes to Brand once every question is answered or they were skipped", () => {
    const answered = saved({
      brandBrain: { ...brain, questions: [question("yes"), question("no")] },
    });
    expect(onboardingStep(answered).step).toBe("brand");
    const open = saved({
      brandBrain: { ...brain, questions: [question()] },
    });
    expect(onboardingStep(open, ["questions"])).toEqual({
      step: "brand",
      phase: "review",
    });
    // Skipping the accounts does not skip the questions.
    expect(onboardingStep(open, ["accounts"]).phase).toBe("asking");
  });

  it("shows Brand while the Brand Brain is not confirmed", () => {
    expect(onboardingStep(saved())).toEqual({
      step: "brand",
      phase: "review",
    });
  });

  it("asks for a plan once Brand is confirmed and nothing is planned", () => {
    expect(onboardingStep(saved({ brandBrainConfirmedAt: confirmed }))).toEqual(
      { step: "plan", phase: "writing-needed" },
    );
  });

  it("waits on the planning screen while the first plan is written", () => {
    expect(
      onboardingStep(
        saved({
          brandBrainConfirmedAt: confirmed,
          work: running("strategy"),
        }),
      ),
    ).toEqual({ step: "plan", phase: "planning" });
    // A stopped planning run keeps the screen, where Cuso offers a retry.
    expect(
      onboardingStep(
        saved({
          brandBrainConfirmedAt: confirmed,
          work: running("strategy", "failed"),
        }),
      ).phase,
    ).toBe("planning");
    // Core starts the first plan when the research ends: until the founder
    // confirms the brand, they stay on Brand.
    expect(onboardingStep(saved({ work: running("strategy") }))).toEqual({
      step: "brand",
      phase: "review",
    });
    // The plan part shows while Cuso writes the calendar.
    expect(onboardingStep(draft({ work: running("strategy") }))).toEqual({
      step: "plan",
      phase: "review",
    });
    expect(
      onboardingStep(
        draft({
          strategy: { ...cmoStrategy, changes: [], calendar: [] },
          work: running("strategy"),
        }),
      ).phase,
    ).toBe("review");
    // A first plan that stopped before its calendar offers a retry.
    expect(
      onboardingStep(
        draft({ strategy: { ...cmoStrategy, changes: [], calendar: [] } }),
      ).phase,
    ).toBe("planning");
  });

  it("reviews a whole plan, and keeps it on screen while Cuso changes it", () => {
    expect(onboardingStep(draft())).toEqual({ step: "plan", phase: "review" });
    const changed = { ...cmoStrategy, changes: ["X now once a week"] };
    expect(
      onboardingStep(draft({ strategy: changed, work: running("strategy") })),
    ).toEqual({ step: "plan", phase: "review" });
  });

  it("reviews the plan with a no that is not fitted yet", () => {
    const answered = {
      ...cmoStrategy,
      changes: [],
      questions: [
        { id: "a", question: "Right?", statement: "Right", answer: "yes" },
        { id: "b", question: "Sure?", statement: "Sure", answer: "no" },
      ] as const,
    };
    const overview = draft({
      strategy: { ...answered, questions: [...answered.questions] },
    });
    expect(onboardingStep(overview)).toEqual({ step: "plan", phase: "review" });
    expect(planUnfitted(overview)).toBe(true);
    // The fitting keeps the plan on screen.
    expect(
      onboardingStep({ ...overview, work: running("strategy") }).phase,
    ).toBe("review");
    expect(
      planUnfitted({
        ...overview,
        strategy: {
          ...answered,
          questions: [...answered.questions],
          changes: ["Fitted"],
        },
      }),
    ).toBe(false);
    // A later no after a revision clears changes in Core, so Update plan
    // shows again instead of Approve.
    expect(
      planUnfitted({
        ...overview,
        strategy: {
          ...answered,
          questions: [
            ...answered.questions,
            {
              id: "c",
              question: "Again?",
              statement: "Again",
              answer: "no",
            },
          ],
          changes: [],
        },
      }),
    ).toBe(true);
  });

  it("stays on Plan for a viewer who cannot approve", () => {
    expect(onboardingStep(draft({ viewerCanApprove: false }))).toEqual({
      step: "plan",
      phase: "review",
    });
  });

  it("launches once the plan is approved, while accounts are pending", () => {
    expect(
      onboardingStep(
        draft({
          ...cmoStrategyVersion(new Date()),
          onboardingStep: "accounts",
        }),
      ),
    ).toEqual({ step: "launch", phase: "review" });
  });
});
