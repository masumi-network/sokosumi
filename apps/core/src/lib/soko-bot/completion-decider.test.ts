import { describe, expect, it, vi } from "vitest";
import { expectCoreLog } from "@/test/core-log";
import {
  buildCompletionBouncePrompt,
  buildCompletionQuestions,
  buildCompletionState,
  COMPLETION_DECIDER_POLICY_VERSION,
  type CompletionDeciderContext,
  decideCompletionWithJev,
  inspectDraft,
  receiptToRuntimeEventData,
  selectBoundedReceipts,
} from "./completion-decider";
import type { evaluateWithJev, JevAnswer } from "./jev";

function makeCtx(
  overrides: Partial<CompletionDeciderContext> = {},
): CompletionDeciderContext {
  return {
    request: "Create a weekly status report and upload it to Files.",
    rootRequest: null,
    isFollowUpWake: false,
    turnSource: "CHAT",
    draft: "I looked at the tasks and here is a quick summary.",
    plan: null,
    openSteps: [],
    receipts: [],
    readCalls: [
      { capability: "list_tasks", completedCount: 1, failedCount: 0 },
    ],
    pendingDecisionCount: 0,
    unresolvedRefusals: [],
    waitingOnOthers: false,
    availableWriteTools: ["upload_file", "create_social_post", "create_task"],
    availableReadToolCount: 8,
    alreadyBounced: false,
    hasPlanLoop: false,
    ...overrides,
  };
}

function mockJev(
  answers: Record<string, JevAnswer>,
  costUsd = 0.00005,
): typeof evaluateWithJev {
  return vi.fn(async () => ({
    answers: new Map(Object.entries(answers)),
    costUsd,
  }));
}

describe("completion-decider (experiment E3)", () => {
  describe("inspectDraft", () => {
    it("parses JSON action narratives and detects questions and silence", () => {
      expect(
        inspectDraft(
          JSON.stringify({
            kind: "CLARIFY",
            message: "Which project should I use?",
            question: "TARGET",
            observationToolCallIds: [],
          }),
        ),
      ).toEqual({
        silent: false,
        kind: "CLARIFY",
        text: "Which project should I use?",
        asksOwner: true,
      });

      expect(
        inspectDraft(
          JSON.stringify({
            kind: "SILENT",
            message: null,
            question: null,
            observationToolCallIds: [],
          }),
        ).silent,
      ).toBe(true);

      expect(inspectDraft("   ").silent).toBe(true);
      expect(inspectDraft("All done.").asksOwner).toBe(false);
      expect(inspectDraft("Which account do you prefer?").asksOwner).toBe(true);
    });
  });

  describe("host menu pre-filtering", () => {
    it("skips Jev entirely when already bounced, quiet-wake silent, waiting on others, or without tools", async () => {
      const evaluate = mockJev({});
      for (const [reason, patch] of [
        ["already_bounced", { alreadyBounced: true }],
        ["silent_draft", { turnSource: "EVENT", draft: "Nothing to add." }],
        ["silent_draft", { turnSource: "SCHEDULE", draft: "Nothing to add." }],
        ["waiting_on_others", { waitingOnOthers: true }],
        ["no_tools", { availableWriteTools: [], availableReadToolCount: 0 }],
      ] as const) {
        const result = await decideCompletionWithJev(makeCtx(patch), {
          evaluate,
        });
        expect(result.action).toBe("finish");
        expect(result.receipt.validation).toBe("skipped_prefilter");
        expect(result.receipt.validationDetail).toBe(reason);
        expect(result.receipt.bounced).toBe(false);
        expect(result.receipt.fallback).toBe(false);
      }
      expect(evaluate).not.toHaveBeenCalled();
    });

    it("keeps an explicitly requested CHAT reply and unfinished local step when the draft is silent", async () => {
      const steps = [
        {
          id: "s1",
          step: "Read the minutes and reply to the owner",
          status: "in_progress" as const,
        },
      ];
      const evaluate = mockJev({
        decision: {
          type: "choice",
          choice: "abstain",
          probabilities: { abstain: 1 },
        },
      });
      const result = await decideCompletionWithJev(
        makeCtx({
          request: "Read the minutes and tell me who took notes.",
          draft: "Nothing to add.",
          hasPlanLoop: true,
          plan: { revision: 1, requestId: "r", steps },
          openSteps: steps,
        }),
        { evaluate },
      );
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(result.action !== "finish" || result.usePlanLoopFallback).toBe(
        true,
      );
      expect(result.receipt.fallback).toBe(true);
      expect(result.receipt.fallbackPolicy).toBe("plan_loop_done_check");

      // A quiet EVENT wake with open plan steps is also evaluated rather than silently dropped.
      const wakeResult = await decideCompletionWithJev(
        makeCtx({
          turnSource: "EVENT",
          isFollowUpWake: true,
          draft: "Nothing to add.",
          hasPlanLoop: true,
          plan: { revision: 1, requestId: "r", steps },
          openSteps: steps,
        }),
        { evaluate },
      );
      expect(wakeResult.usePlanLoopFallback).toBe(true);
      expect(wakeResult.receipt.validation).toBe("abstained");
    });

    it("still checks when waitingOnOthers is true but a local step is in_progress", () => {
      const { candidates, targetCandidates } = buildCompletionQuestions(
        makeCtx({
          waitingOnOthers: true,
          openSteps: [
            { id: "s2", step: "Draft summary", status: "in_progress" },
          ],
        }),
      );
      expect(candidates).toContain("continue");
      expect(targetCandidates).toEqual(["step:s2"]);
    });

    it("offers named step candidates when 2+ open plan steps exist, and gap candidates without open steps", () => {
      const withSteps = buildCompletionQuestions(
        makeCtx({
          openSteps: [
            { id: "s1", step: "Prepare graphics", status: "pending" },
            { id: "s2", step: "Draft social post", status: "pending" },
          ],
        }),
      );
      expect(withSteps.targetCandidates).toEqual(["step:s1", "step:s2"]);
      expect(withSteps.questions.target?.type).toBe("choice");

      const withoutSteps = buildCompletionQuestions(makeCtx());
      expect(withoutSteps.targetCandidates).toEqual([
        "gap:unread_context",
        "gap:incomplete_work",
        "gap:unsettled_receipt",
      ]);
      expect(withoutSteps.questions.target?.type).toBe("choice");
    });
  });

  describe("decisions, validation, re-check, and fallback", () => {
    it("lets a confident finish pass with a valid receipt", async () => {
      const evaluate = mockJev({
        decision: {
          type: "choice",
          choice: "finish",
          probabilities: {
            finish: 0.92,
            continue: 0.04,
            ask_owner: 0.02,
            abstain: 0.02,
          },
        },
      });
      const result = await decideCompletionWithJev(makeCtx(), {
        evaluate,
        now: () => 1_000,
      });
      expect(result.action).toBe("finish");
      expect(result.receipt).toMatchObject({
        stage: "completion",
        policyVersion: COMPLETION_DECIDER_POLICY_VERSION,
        mode: "completion_decider",
        choice: "finish",
        abstained: false,
        validation: "valid",
        fallback: false,
        fallbackPolicy: null,
        outcome: "finish",
        bounced: false,
        costUsd: 0.00005,
      });
      expect(receiptToRuntimeEventData(result.receipt).choice).toBe("finish");
    });

    it("continues without a plan when Jev confidently spots incomplete work", async () => {
      const ctx = makeCtx({
        receipts: [
          { capability: "create_task", label: "id t1", outcome: "done" },
        ],
      });
      const evaluate = mockJev({
        decision: {
          type: "choice",
          choice: "continue",
          probabilities: {
            finish: 0.08,
            continue: 0.86,
            ask_owner: 0.03,
            abstain: 0.03,
          },
        },
        target: {
          type: "choice",
          choice: "gap:incomplete_work",
          probabilities: {
            "gap:unread_context": 0.05,
            "gap:incomplete_work": 0.9,
            "gap:unsettled_receipt": 0.05,
          },
        },
      });
      const result = await decideCompletionWithJev(ctx, { evaluate });
      expect(result.action).toBe("continue");
      expect(result.continueGap).toBe("incomplete_work");
      expect(result.receipt.bounced).toBe(true);
      expect(result.receipt.chosenTarget).toBe("gap:incomplete_work");

      const prompt = buildCompletionBouncePrompt({
        ctx,
        decision: result,
        openStepsText: "",
        savedNoteText: "",
      });
      expect(prompt).toContain("Core's receipts for this request so far:");
      expect(prompt).toContain("- create_task (id t1): done");
      expect(prompt).toContain("Do not repeat any save marked done");
    });

    it("names the specific open plan step Jev picked when continuing with a plan", async () => {
      const openSteps = [
        { id: "s2", step: "Generate two visuals", status: "pending" as const },
        { id: "s3", step: "Draft social post", status: "pending" as const },
      ];
      const ctx = makeCtx({
        hasPlanLoop: true,
        plan: {
          requestId: "req-1",
          revision: 2,
          steps: [
            { id: "s1", step: "Read briefing", status: "done" },
            ...openSteps,
          ],
        },
        openSteps,
      });
      const evaluate = mockJev({
        decision: {
          type: "choice",
          choice: "continue",
          probabilities: {
            finish: 0.05,
            continue: 0.88,
            ask_owner: 0.04,
            abstain: 0.03,
          },
        },
        target: {
          type: "choice",
          choice: "step:s2",
          probabilities: { "step:s2": 0.82, "step:s3": 0.18 },
        },
      });

      const result = await decideCompletionWithJev(ctx, {
        evaluate,
        recheckState: async () => ({
          alreadyBounced: false,
          waitingOnOthers: false,
          openStepIds: ["s2", "s3"],
          hasTools: true,
        }),
      });
      expect(result.action).toBe("continue");
      expect(result.namedStep?.id).toBe("s2");
      expect(result.receipt.chosenTarget).toBe("step:s2");

      const prompt = buildCompletionBouncePrompt({
        ctx,
        decision: result,
        openStepsText:
          "- s2 [pending] Generate two visuals\n- s3 [pending] Draft social post",
        savedNoteText: "",
      });
      expect(prompt).toContain(
        "Next open step to act on now: s2 [pending] Generate two visuals",
      );
      expect(prompt).toContain("update_plan (revision 2)");
    });

    it("rejects a stale step pick when recheckState shows the step is no longer open", async () => {
      const openSteps = [
        { id: "s2", step: "Generate two visuals", status: "pending" as const },
        { id: "s3", step: "Draft social post", status: "pending" as const },
      ];
      const ctx = makeCtx({
        hasPlanLoop: true,
        plan: { requestId: "req-1", revision: 2, steps: openSteps },
        openSteps,
      });
      const evaluate = mockJev({
        decision: {
          type: "choice",
          choice: "continue",
          probabilities: {
            finish: 0.05,
            continue: 0.9,
            ask_owner: 0.03,
            abstain: 0.02,
          },
        },
        target: {
          type: "choice",
          choice: "step:s2",
          probabilities: { "step:s2": 0.85, "step:s3": 0.15 },
        },
      });

      const result = await decideCompletionWithJev(ctx, {
        evaluate,
        recheckState: async () => ({
          alreadyBounced: false,
          waitingOnOthers: false,
          openStepIds: ["s3"],
          hasTools: true,
        }),
      });
      expect(result.receipt.validation).toBe("stale");
      expect(result.receipt.validationDetail).toBe(
        "chosen_step_no_longer_open:s2",
      );
      expect(result.receipt.fallback).toBe(true);
      expect(result.receipt.fallbackPolicy).toBe("plan_loop_done_check");
      expect(result.usePlanLoopFallback).toBe(true);
    });

    it("rejects continue as stale when recheck shows the turn is now waiting on others with no in-progress step", async () => {
      const openSteps = [
        { id: "s1", step: "Local draft", status: "in_progress" as const },
        { id: "s2", step: "Wait on research", status: "pending" as const },
      ];
      const ctx = makeCtx({
        hasPlanLoop: true,
        plan: { requestId: "req-1", revision: 1, steps: openSteps },
        openSteps,
      });
      const result = await decideCompletionWithJev(ctx, {
        evaluate: mockJev({
          decision: {
            type: "choice",
            choice: "continue",
            probabilities: {
              finish: 0.05,
              continue: 0.9,
              ask_owner: 0.03,
              abstain: 0.02,
            },
          },
          target: {
            type: "choice",
            choice: "step:s2",
            probabilities: { "step:s1": 0.2, "step:s2": 0.8 },
          },
        }),
        recheckState: async () => ({
          alreadyBounced: false,
          waitingOnOthers: true,
          openStepIds: ["s2"],
          hasInProgressStep: false,
          hasTools: true,
        }),
      });
      expect(result.receipt.validation).toBe("stale");
      expect(result.receipt.validationDetail).toBe("now_waiting_on_others");
      expect(result.receipt.fallback).toBe(true);
      expect(result.receipt.bounced).toBe(false);
    });

    it("lets ask_owner pass when the draft already asks, and bounces when an unresolved refusal went unasked", async () => {
      const passing = await decideCompletionWithJev(
        makeCtx({
          draft: "Which of your two connected accounts should I use?",
          hasPlanLoop: true,
          openSteps: [
            { id: "s1", step: "Pick account", status: "pending" },
            { id: "s2", step: "Create draft", status: "pending" },
          ],
        }),
        {
          evaluate: mockJev({
            decision: {
              type: "choice",
              choice: "ask_owner",
              probabilities: {
                finish: 0.05,
                continue: 0.05,
                ask_owner: 0.88,
                abstain: 0.02,
              },
            },
          }),
        },
      );
      expect(passing.action).toBe("ask_owner_pass");
      expect(passing.receipt.bounced).toBe(false);

      const bouncingCtx = makeCtx({
        draft: "I could not finish the draft right now.",
        unresolvedRefusals: [
          {
            capability: "create_social_post",
            errorDetail: "Multiple accounts match; ask the owner which to use.",
          },
        ],
      });
      const bouncing = await decideCompletionWithJev(bouncingCtx, {
        evaluate: mockJev({
          decision: {
            type: "choice",
            choice: "ask_owner",
            probabilities: {
              finish: 0.1,
              continue: 0.08,
              ask_owner: 0.8,
              abstain: 0.02,
            },
          },
        }),
      });
      expect(bouncing.action).toBe("ask_owner_bounce");
      expect(bouncing.receipt.bounced).toBe(true);
      const prompt = buildCompletionBouncePrompt({
        ctx: bouncingCtx,
        decision: bouncing,
        openStepsText: "",
        savedNoteText: "",
      });
      expect(prompt).toContain("create_social_post");
      expect(prompt).toContain("Ask the owner one concrete question");
    });

    it("falls back to plan_loop_done_check on abstain or Jev error when planLoop has open steps, and to finish otherwise", async () => {
      const abstainJev = mockJev({
        decision: {
          type: "choice",
          choice: "abstain",
          probabilities: {
            finish: 0.2,
            continue: 0.25,
            ask_owner: 0.1,
            abstain: 0.45,
          },
        },
      });
      const withPlan = await decideCompletionWithJev(
        makeCtx({
          hasPlanLoop: true,
          openSteps: [{ id: "s1", step: "Save file", status: "pending" }],
        }),
        { evaluate: abstainJev },
      );
      expect(withPlan.receipt.abstained).toBe(true);
      expect(withPlan.receipt.validation).toBe("abstained");
      expect(withPlan.receipt.fallback).toBe(true);
      expect(withPlan.receipt.fallbackPolicy).toBe("plan_loop_done_check");
      expect(withPlan.usePlanLoopFallback).toBe(true);

      const warned = expectCoreLog(
        "warn",
        "Completion decider Jev call failed; using fallback",
      );
      const withoutPlan = await decideCompletionWithJev(makeCtx(), {
        evaluate: vi.fn(async () => {
          throw new Error("timeout");
        }),
      });
      expect(warned).toHaveLength(1);
      expect(withoutPlan.receipt.validation).toBe("error");
      expect(withoutPlan.receipt.fallback).toBe(true);
      expect(withoutPlan.receipt.fallbackPolicy).toBe("finish");
      expect(withoutPlan.usePlanLoopFallback).toBe(false);
    });

    it("requires higher confidence to continue without open plan steps, avoiding false bounces", async () => {
      const borderline = await decideCompletionWithJev(makeCtx(), {
        evaluate: mockJev({
          decision: {
            type: "choice",
            choice: "continue",
            probabilities: {
              finish: 0.25,
              continue: 0.68,
              ask_owner: 0.05,
              abstain: 0.02,
            },
          },
        }),
      });
      expect(borderline.action).toBe("finish");
      expect(borderline.receipt.validation).toBe("low_confidence");
      expect(borderline.receipt.fallback).toBe(true);
    });

    it("does not count an off-menu or missing target as a successful named continuation", async () => {
      const steps = [
        { id: "s1", step: "Read the minutes", status: "pending" as const },
        { id: "s2", step: "Draft the response", status: "pending" as const },
      ];
      for (const includeTarget of [true, false]) {
        const result = await decideCompletionWithJev(
          makeCtx({
            hasPlanLoop: true,
            openSteps: steps,
            plan: { requestId: "r", revision: 1, steps },
          }),
          {
            evaluate: mockJev({
              decision: {
                type: "choice",
                choice: "continue",
                probabilities: { continue: 1 },
              },
              ...(includeTarget
                ? {
                    target: {
                      type: "choice",
                      choice: "gap:unread_context",
                      probabilities: { "gap:unread_context": 1 },
                    },
                  }
                : {}),
            }),
          },
        );
        expect(result.receipt.targetCandidates).toEqual(["step:s1", "step:s2"]);
        expect(result.receipt.validation).toBe("invalid");
        expect(result.receipt.fallback).toBe(true);
        expect(result.receipt.chosenTarget).toBeNull();
        expect(result.receipt.bounced).toBe(false);
        expect(result.usePlanLoopFallback).toBe(true);
      }

      // Same rejection when the gap menu is offered (no open plan steps).
      for (const bogusTarget of ["step:s1", null]) {
        const result = await decideCompletionWithJev(makeCtx(), {
          evaluate: mockJev({
            decision: {
              type: "choice",
              choice: "continue",
              probabilities: { continue: 1 },
            },
            ...(bogusTarget
              ? {
                  target: {
                    type: "choice",
                    choice: bogusTarget,
                    probabilities: { [bogusTarget]: 1 },
                  },
                }
              : {}),
          }),
        });
        expect(result.receipt.validation).toBe("invalid");
        expect(result.receipt.fallback).toBe(true);
        expect(result.receipt.fallbackPolicy).toBe("finish");
        expect(result.receipt.chosenTarget).toBeNull();
        expect(result.action).toBe("finish");
      }
    });

    it("preserves unresolved writes ahead of twenty later confirmed writes and summarizes overflow", () => {
      const ctx = makeCtx({
        receipts: [
          {
            capability: "publish_social_post",
            label: "first post",
            outcome: "unconfirmed",
          },
          ...Array.from({ length: 20 }, (_, i) => ({
            capability: "upload_file",
            label: `file ${i}`,
            outcome: "done" as const,
          })),
        ],
      });
      const state = buildCompletionState(ctx) as Record<string, unknown>;
      expect(JSON.stringify(state)).toContain("unconfirmed");
      expect(state.coreWriteReceipts).toHaveLength(20);
      expect(
        (state.coreWriteReceipts as Array<Record<string, unknown>>)[0],
      ).toEqual(
        expect.objectContaining({
          capability: "publish_social_post",
          outcome: "unconfirmed",
        }),
      );
      expect(state.coreWriteReceiptsOverflow).toEqual({
        totalReceipts: 21,
        shownReceipts: 20,
        omittedDoneCount: 1,
        omittedUnresolvedCount: 0,
        omittedByCapability: { upload_file: 1 },
      });

      // Bounce prompt keeps unresolved receipts ahead of confirmed ones and notes overflow.
      const prompt = buildCompletionBouncePrompt({
        ctx,
        decision: {
          receipt: {
            stage: "completion",
            policyVersion: COMPLETION_DECIDER_POLICY_VERSION,
            mode: "completion_decider",
            candidates: ["finish", "continue", "ask_owner", "abstain"],
            targetCandidates: ["gap:unsettled_receipt"],
            choice: "continue",
            chosenTarget: "gap:unsettled_receipt",
            abstained: false,
            probabilities: { continue: 0.9 },
            targetProbabilities: { "gap:unsettled_receipt": 0.9 },
            validation: "valid",
            validationDetail: null,
            fallback: false,
            fallbackPolicy: null,
            outcome: "continue",
            bounced: true,
            latencyMs: 10,
            costUsd: 0,
            stateSummary: {
              hasPlan: false,
              openStepCount: 0,
              receiptCount: 21,
              waitingOnOthers: false,
              ownerBlocker: false,
              draftAsksOwner: false,
              turnSource: "CHAT",
              isFollowUpWake: false,
            },
          },
          action: "continue",
          namedStep: null,
          continueGap: "unsettled_receipt",
          usePlanLoopFallback: false,
        },
        openStepsText: "",
        savedNoteText: "",
      });
      expect(prompt).toContain(
        "publish_social_post (first post): Core could not confirm",
      );
      expect(prompt).toContain("11 earlier confirmed save(s) omitted above.");

      // When unresolved receipts themselves exceed limit, prioritize unconfirmed > not done > started.
      const overflowUnresolved = selectBoundedReceipts(
        [
          { capability: "a", label: "1", outcome: "started" },
          { capability: "b", label: "2", outcome: "not done" },
          { capability: "c", label: "3", outcome: "unconfirmed" },
          { capability: "d", label: "4", outcome: "done" },
        ],
        2,
      );
      expect(overflowUnresolved.shown.map((r) => r.outcome)).toEqual([
        "not done",
        "unconfirmed",
      ]);
      expect(overflowUnresolved.omittedDoneCount).toBe(1);
      expect(overflowUnresolved.omittedUnresolvedCount).toBe(1);
    });

    it("never finishes as done on an unconfirmed publish (withholds finish, forces read-back fallback, keeps confirmed refusal as negative control)", async () => {
      const unconfirmedCtx = makeCtx({
        request: "Publish the approved announcement post now.",
        draft: "I published the announcement post.",
        receipts: [
          {
            capability: "publish_social_post",
            label: "id post-1",
            outcome: "unconfirmed",
          },
        ],
      });

      // Host menu withholds finish whenever Core recorded an unconfirmed effect,
      // even if another delegation/watch is active or the draft is silent.
      expect(buildCompletionQuestions(unconfirmedCtx).candidates).toEqual([
        "continue",
        "ask_owner",
        "abstain",
      ]);
      expect(
        buildCompletionQuestions({
          ...unconfirmedCtx,
          waitingOnOthers: true,
        }).candidates,
      ).toEqual(["continue", "ask_owner", "abstain"]);

      // Even if Jev returns finish, abstain, low-confidence continue, or throws,
      // the turn stays open for a read-back (fallback=true, never finish).
      const warned = expectCoreLog(
        "warn",
        "Completion decider Jev call failed; using fallback",
      );
      for (const evaluator of [
        mockJev({
          decision: {
            type: "choice",
            choice: "finish",
            probabilities: { finish: 1 },
          },
        }),
        mockJev({
          decision: {
            type: "choice",
            choice: "abstain",
            probabilities: { abstain: 1 },
          },
        }),
        mockJev({
          decision: {
            type: "choice",
            choice: "continue",
            probabilities: { continue: 0.5, ask_owner: 0.3, abstain: 0.2 },
          },
        }),
        vi.fn(async () => {
          throw new Error("timeout");
        }),
      ]) {
        const result = await decideCompletionWithJev(unconfirmedCtx, {
          evaluate: evaluator,
        });
        expect(result.action).toBe("continue");
        expect(result.continueGap).toBe("unsettled_receipt");
        expect(result.receipt.fallback).toBe(true);
        expect(result.receipt.fallbackPolicy).toBe("unconfirmed_readback");
        expect(result.receipt.bounced).toBe(true);
        const prompt = buildCompletionBouncePrompt({
          ctx: unconfirmedCtx,
          decision: result,
          openStepsText: "",
          savedNoteText: "",
        });
        expect(prompt).toContain("Core could not confirm");
        expect(prompt).toContain("read back");
        expect(prompt).toContain(
          "never report an unconfirmed action as completed or failed",
        );
      }
      expect(warned).toHaveLength(1);

      // Asking the owner explicitly can pass via ask_owner_pass (never finish).
      const askOwnerPass = await decideCompletionWithJev(
        {
          ...unconfirmedCtx,
          draft:
            "Core could not confirm whether the post published and I could not verify it. Should I check again or leave it?",
        },
        {
          evaluate: mockJev({
            decision: {
              type: "choice",
              choice: "ask_owner",
              probabilities: { continue: 0.08, ask_owner: 0.9, abstain: 0.02 },
            },
          }),
        },
      );
      expect(askOwnerPass.action).toBe("ask_owner_pass");
      expect(askOwnerPass.receipt.bounced).toBe(false);

      // Live recheck stops a fallback read-back if the turn was already bounced.
      const staleRecheck = await decideCompletionWithJev(unconfirmedCtx, {
        evaluate: mockJev({
          decision: {
            type: "choice",
            choice: "abstain",
            probabilities: { abstain: 1 },
          },
        }),
        recheckState: async () => ({
          alreadyBounced: true,
          waitingOnOthers: false,
          openStepIds: null,
          hasTools: true,
        }),
      });
      expect(staleRecheck.action).toBe("finish");
      expect(staleRecheck.receipt.validation).toBe("stale");
      expect(staleRecheck.receipt.bounced).toBe(false);

      // Negative control: a confirmed refusal (outcome: "not done") still offers
      // finish so the bot can report the refusal and end cleanly.
      const refusedCtx = makeCtx({
        request: "Publish the post now.",
        draft: "Core refused the publish because the post is not approved yet.",
        receipts: [
          {
            capability: "publish_social_post",
            label: "id post-1",
            outcome: "not done",
            errorKind: "refused",
            errorDetail: "Post is not approved",
          },
        ],
      });
      expect(buildCompletionQuestions(refusedCtx).candidates).toContain(
        "finish",
      );
      const refusedResult = await decideCompletionWithJev(refusedCtx, {
        evaluate: mockJev({
          decision: {
            type: "choice",
            choice: "finish",
            probabilities: {
              finish: 0.92,
              continue: 0.04,
              ask_owner: 0.02,
              abstain: 0.02,
            },
          },
        }),
      });
      expect(refusedResult.action).toBe("finish");
      expect(refusedResult.receipt.fallback).toBe(false);
      expect(refusedResult.receipt.bounced).toBe(false);
    });

    it("bounds request, rootRequest, and draft fields in Jev state", () => {
      const state = buildCompletionState(
        makeCtx({
          request: "a".repeat(5_000),
          rootRequest: "b".repeat(5_000),
          draft: "c".repeat(5_000),
          isFollowUpWake: true,
        }),
      ) as Record<string, unknown>;
      expect((state.request as string).length).toBe(2_500);
      expect((state.originatingOwnerRequest as string).length).toBe(1_200);
      expect((state.draftReply as string).length).toBe(2_500);
      expect(state.isFollowUpWake).toBe(true);
    });
  });
});
