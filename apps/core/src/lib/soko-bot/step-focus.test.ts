import {
  buildStepFocusBundles,
  type SokoBotCapability,
  STEP_FOCUS_INSPECT_CAPABILITIES,
  STEP_FOCUS_VERIFY_CAPABILITIES,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authorizeMock,
  resolveVersionMock,
  turnFindUniqueMock,
  toolCallFindManyMock,
  pendingDecisionFindFirstMock,
  runtimeEventCreateMock,
  runtimeEventFindFirstMock,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(),
  resolveVersionMock: vi.fn(),
  turnFindUniqueMock: vi.fn(),
  toolCallFindManyMock: vi.fn(),
  pendingDecisionFindFirstMock: vi.fn(),
  runtimeEventCreateMock: vi.fn(),
  runtimeEventFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => new Date(),
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    sokoBotTurn: { findUnique: turnFindUniqueMock },
    sokoBotToolCall: { findMany: toolCallFindManyMock },
    sokoBotPendingDecision: { findFirst: pendingDecisionFindFirstMock },
    sokoBotRuntimeEvent: {
      create: runtimeEventCreateMock,
      findFirst: runtimeEventFindFirstMock,
    },
  };
  return {
    default: {
      ...client,
      $transaction: async (op: (tx: unknown) => Promise<unknown>) =>
        op({ ...client, $executeRaw: vi.fn() }),
    },
  };
});
vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: { authorize: authorizeMock },
}));
vi.mock("@/services/soko-bot-version.service", () => ({
  resolveRunnableSokoBotVersion: resolveVersionMock,
}));

import {
  buildVerifyReceiptsNote,
  filterStepFocusCandidates,
  recordTurnStepFocusOutcome,
  STEP_FOCUS_DECISION_EVENT,
  STEP_FOCUS_OUTCOME_EVENT,
  type StepFocusEvaluator,
  selectStepFocusWithEvaluator,
  selectTurnStepFocus,
} from "./step-focus";

const MIXED_TOOLS: SokoBotCapability[] = [
  "list_tasks",
  "read_file",
  "web_search",
  "update_plan",
  "create_task",
  "create_social_post",
];

const READ_ONLY_TOOLS: SokoBotCapability[] = [
  "list_tasks",
  "read_file",
  "update_plan",
];

function baseInput(
  overrides: Partial<Parameters<typeof selectStepFocusWithEvaluator>[0]> = {},
): Parameters<typeof selectStepFocusWithEvaluator>[0] {
  return {
    decisionId: "focus_test_1",
    userRequest: "Review open tasks and create a summary draft.",
    source: "CHAT",
    routeHint: "MANAGE_WORK",
    background: false,
    stepIndex: 0,
    roundIndex: 0,
    stepsInRound: 0,
    stepsRemaining: 20,
    bundles: buildStepFocusBundles(MIXED_TOOLS, MIXED_TOOLS),
    plan: null,
    recentSteps: [],
    receipts: [],
    hasAttemptedWrite: false,
    hasPendingBlocker: false,
    consecutiveInspect: 0,
    consecutiveVerify: 0,
    justExpandedShortForm: false,
    ...overrides,
  };
}

describe("filterStepFocusCandidates", () => {
  it("excludes act on read-only turns and excludes verify before any write", () => {
    const result = filterStepFocusCandidates({
      bundles: buildStepFocusBundles(MIXED_TOOLS, READ_ONLY_TOOLS),
      stepIndex: 0,
      roundIndex: 0,
      stepsInRound: 0,
      background: false,
      hasAttemptedWrite: false,
      receiptCount: 0,
      openUnblockedPlanCount: 0,
      hasPendingBlocker: false,
      justExpandedShortForm: false,
    });

    expect(result.candidates).toEqual(["inspect", "answer"]);
    expect(result.filteredOut).toEqual({
      act: "no_granted_write_tools",
      verify: "no_prior_writes",
    });
  });

  it("includes verify after unresolved receipts or open plan steps, and skips verify when all receipts are confirmed with no open plan", () => {
    const unresolved = filterStepFocusCandidates({
      bundles: buildStepFocusBundles(MIXED_TOOLS, MIXED_TOOLS),
      stepIndex: 2,
      roundIndex: 0,
      stepsInRound: 2,
      background: false,
      hasAttemptedWrite: true,
      receiptCount: 1,
      hasUnresolvedReceipt: true,
      openUnblockedPlanCount: 0,
      hasPendingBlocker: false,
      justExpandedShortForm: false,
    });
    expect(unresolved.candidates).toEqual([
      "inspect",
      "act",
      "verify",
      "answer",
    ]);
    expect(unresolved.filteredOut).toEqual({});

    const allConfirmed = filterStepFocusCandidates({
      bundles: buildStepFocusBundles(MIXED_TOOLS, MIXED_TOOLS),
      stepIndex: 2,
      roundIndex: 0,
      stepsInRound: 2,
      background: false,
      hasAttemptedWrite: true,
      receiptCount: 1,
      hasUnresolvedReceipt: false,
      openUnblockedPlanCount: 0,
      hasPendingBlocker: false,
      justExpandedShortForm: false,
    });
    expect(allConfirmed.candidates).toEqual(["inspect", "act", "answer"]);
    expect(allConfirmed.filteredOut).toEqual({
      verify: "all_receipts_confirmed",
    });
  });

  it("excludes answer on step 0 of a continuation round or background run", () => {
    const continuation = filterStepFocusCandidates({
      bundles: buildStepFocusBundles(MIXED_TOOLS, MIXED_TOOLS),
      stepIndex: 3,
      roundIndex: 1,
      stepsInRound: 0,
      background: false,
      hasAttemptedWrite: true,
      receiptCount: 1,
      openUnblockedPlanCount: 1,
      hasPendingBlocker: false,
      justExpandedShortForm: false,
    });
    expect(continuation.candidates).not.toContain("answer");
    expect(continuation.filteredOut.answer).toBe("fresh_continuation_round");

    const backgroundStep0 = filterStepFocusCandidates({
      bundles: buildStepFocusBundles(MIXED_TOOLS, MIXED_TOOLS),
      stepIndex: 0,
      roundIndex: 0,
      stepsInRound: 0,
      background: true,
      hasAttemptedWrite: false,
      receiptCount: 0,
      openUnblockedPlanCount: 0,
      hasPendingBlocker: false,
      justExpandedShortForm: false,
    });
    expect(backgroundStep0.candidates).not.toContain("answer");
    expect(backgroundStep0.filteredOut.answer).toBe("background_first_step");
  });

  it("forces sole candidate act right after short-form save expansion", () => {
    const result = filterStepFocusCandidates({
      bundles: buildStepFocusBundles(MIXED_TOOLS, MIXED_TOOLS),
      stepIndex: 2,
      roundIndex: 1,
      stepsInRound: 0,
      background: false,
      hasAttemptedWrite: false,
      receiptCount: 0,
      openUnblockedPlanCount: 0,
      hasPendingBlocker: false,
      justExpandedShortForm: true,
    });

    expect(result.candidates).toEqual(["act"]);
  });

  it("excludes answer when 2+ plan steps remain open without an owner blocker", () => {
    const result = filterStepFocusCandidates({
      bundles: buildStepFocusBundles(MIXED_TOOLS, MIXED_TOOLS),
      stepIndex: 2,
      roundIndex: 0,
      stepsInRound: 2,
      background: false,
      hasAttemptedWrite: true,
      receiptCount: 1,
      openUnblockedPlanCount: 2,
      hasPendingBlocker: false,
      justExpandedShortForm: false,
    });

    expect(result.candidates).toEqual(["inspect", "act", "verify"]);
    expect(result.filteredOut.answer).toBe("multiple_open_plan_steps");
  });
});

describe("selectStepFocusWithEvaluator", () => {
  it("passes only host-filtered candidates to Jev and records a complete receipt", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>(async ({ questions }) => {
      const focusQuestion = questions.focus;
      expect(focusQuestion?.type).toBe("choice");
      if (focusQuestion?.type === "choice") {
        expect(Object.keys(focusQuestion.criteria)).toEqual([
          "inspect",
          "act",
          "answer",
        ]);
      }
      return {
        answers: new Map([
          [
            "focus",
            {
              type: "choice",
              choice: "inspect",
              probabilities: { inspect: 0.78, act: 0.18, answer: 0.04 },
            },
          ],
        ]),
        costUsd: 0.00004,
      };
    });

    const result = await selectStepFocusWithEvaluator(baseInput(), evaluator);

    expect(evaluator).toHaveBeenCalledTimes(1);
    expect(result.appliedFocus).toBe("inspect");
    expect(result.usedFallback).toBe(false);
    expect(result.toolChoice).toBe("auto");
    expect(result.allowedTools).toEqual([
      "list_tasks",
      "read_file",
      "web_search",
      "update_plan",
    ]);
    expect(result.allowedTools).not.toContain("create_task");
    expect(result.verifyNote).toBeNull();
    expect(result.receipt).toMatchObject({
      kind: "step_focus",
      decisionId: "focus_test_1",
      source: "jev",
      candidates: ["inspect", "act", "answer"],
      filteredOut: { verify: "no_prior_writes" },
      rawChoice: "inspect",
      abstained: false,
      validation: "accepted",
      usedFallback: false,
      appliedFocus: "inspect",
      bundleToolCount: 4,
      verifyReceiptsInjected: false,
      costUsd: 0.00004,
    });
  });

  it("skips Jev when only one candidate is eligible", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>();
    const result = await selectStepFocusWithEvaluator(
      baseInput({
        bundles: buildStepFocusBundles([], []),
      }),
      evaluator,
    );

    expect(evaluator).not.toHaveBeenCalled();
    expect(result.appliedFocus).toBe("answer");
    expect(result.toolChoice).toBe("none");
    expect(result.allowedTools).toEqual([]);
    expect(result.receipt.source).toBe("single_candidate");
    expect(result.receipt.validation).toBe("single_candidate");
  });

  it("falls back to act when Jev abstains with low confidence on step-0 answer", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>(async () => ({
      answers: new Map([
        [
          "focus",
          {
            type: "choice",
            choice: "answer",
            // Below MIN_STEP0_ANSWER_CONFIDENCE (0.7)
            probabilities: { answer: 0.62, inspect: 0.3, act: 0.08 },
          },
        ],
      ]),
      costUsd: 0.00004,
    }));

    const result = await selectStepFocusWithEvaluator(baseInput(), evaluator);

    expect(result.appliedFocus).toBe("act");
    expect(result.usedFallback).toBe(true);
    expect(result.toolChoice).toBe("auto");
    expect(result.receipt.abstained).toBe(true);
    expect(result.receipt.validation).toBe("low_confidence");
    expect(result.receipt.rawChoice).toBe("answer");
  });

  it("accepts high-confidence answer and sets toolChoice to none with empty bundle", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>(async () => ({
      answers: new Map([
        [
          "focus",
          {
            type: "choice",
            choice: "answer",
            probabilities: { answer: 0.94, inspect: 0.04, act: 0.02 },
          },
        ],
      ]),
      costUsd: 0.00004,
    }));

    const result = await selectStepFocusWithEvaluator(
      baseInput({ userRequest: "Thanks, that looks great!" }),
      evaluator,
    );

    expect(result.appliedFocus).toBe("answer");
    expect(result.usedFallback).toBe(false);
    expect(result.toolChoice).toBe("none");
    expect(result.allowedTools).toEqual([]);
    expect(result.receipt.validation).toBe("accepted");
  });

  it("injects Core receipts and offers read-only verify tools when verify is picked", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>(async () => ({
      answers: new Map([
        [
          "focus",
          {
            type: "choice",
            choice: "verify",
            probabilities: {
              verify: 0.75,
              act: 0.1,
              inspect: 0.05,
              answer: 0.1,
            },
          },
        ],
      ]),
      costUsd: 0.00004,
    }));

    const result = await selectStepFocusWithEvaluator(
      baseInput({
        stepIndex: 2,
        stepsInRound: 2,
        hasAttemptedWrite: true,
        receipts: [
          {
            capability: "create_social_post",
            label: "id post_1",
            outcome: "started",
            line: "create_social_post (id post_1): started, not finished yet",
          },
        ],
      }),
      evaluator,
    );

    expect(result.appliedFocus).toBe("verify");
    expect(result.usedFallback).toBe(false);
    expect(result.allowedTools).toEqual([
      "list_tasks",
      "read_file",
      "update_plan",
    ]);
    expect(result.allowedTools).not.toContain("web_search");
    expect(result.allowedTools).not.toContain("create_social_post");
    expect(result.verifyNote).toContain(
      "create_social_post (id post_1): started, not finished yet",
    );
    expect(result.verifyNoteKey).toBeTruthy();
    expect(result.receipt.verifyReceiptsInjected).toBe(true);
  });

  it("falls back cleanly when Jev errors or times out", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>(async () => {
      throw new Error("TimeoutError");
    });

    const result = await selectStepFocusWithEvaluator(baseInput(), evaluator);

    expect(result.appliedFocus).toBe("act");
    expect(result.usedFallback).toBe(true);
    expect(result.receipt.abstained).toBe(true);
    expect(result.receipt.validation).toBe("jev_error");
  });

  it("rejects a stale 3rd consecutive verify and falls back to answer when no plan steps are open", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>(async () => ({
      answers: new Map([
        [
          "focus",
          {
            type: "choice",
            choice: "verify",
            probabilities: {
              verify: 0.8,
              answer: 0.15,
              act: 0.03,
              inspect: 0.02,
            },
          },
        ],
      ]),
      costUsd: 0.00004,
    }));

    const result = await selectStepFocusWithEvaluator(
      baseInput({
        stepIndex: 4,
        stepsInRound: 4,
        hasAttemptedWrite: true,
        consecutiveVerify: 2,
        receipts: [
          {
            capability: "create_task",
            label: "id task_1",
            outcome: "unconfirmed",
            line: "create_task (id task_1): Core could not confirm whether it happened",
          },
        ],
      }),
      evaluator,
    );

    expect(result.appliedFocus).toBe("answer");
    expect(result.usedFallback).toBe(true);
    expect(result.toolChoice).toBe("none");
    expect(result.receipt.validation).toBe("stale_repeat");
  });

  it("breaks an inspect loop after 4 consecutive inspect steps when act is eligible", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>(async () => ({
      answers: new Map([
        [
          "focus",
          {
            type: "choice",
            choice: "inspect",
            probabilities: { inspect: 0.7, act: 0.25, answer: 0.05 },
          },
        ],
      ]),
      costUsd: 0.00004,
    }));

    const result = await selectStepFocusWithEvaluator(
      baseInput({
        stepIndex: 4,
        stepsInRound: 4,
        consecutiveInspect: 4,
      }),
      evaluator,
    );

    expect(result.appliedFocus).toBe("act");
    expect(result.usedFallback).toBe(true);
    expect(result.receipt.validation).toBe("stale_repeat");
  });

  it("produces deterministic verify receipt keys for identical receipt sets", () => {
    const receipts = [
      {
        capability: "create_task",
        label: "id t1",
        outcome: "done" as const,
        line: "create_task (id t1): done",
      },
    ];
    expect(buildVerifyReceiptsNote(receipts).key).toBe(
      buildVerifyReceiptsNote(receipts).key,
    );
    expect(buildVerifyReceiptsNote([]).key).toBe("empty");
  });

  it("retains unresolved failures even when more than 10 later done receipts exist", () => {
    const receipts = [
      {
        capability: "create_schedule",
        label: "id sched_bad",
        outcome: "not done" as const,
        line: "create_schedule (id sched_bad): did not happen",
      },
      ...Array.from({ length: 15 }, (_, index) => ({
        capability: "create_social_post",
        label: `id post_${index + 1}`,
        outcome: "done" as const,
        line: `create_social_post (id post_${index + 1}): done`,
      })),
    ];
    const { note } = buildVerifyReceiptsNote(receipts);
    expect(note).toContain("create_schedule (id sched_bad): did not happen");
    expect(note).toContain("earlier confirmed receipts omitted");
    expect(note).toContain("create_social_post (id post_15): done");
  });

  it("accepts a winning answer on a read-only turn after inspection without an action confidence gate", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>(async () => ({
      answers: new Map([
        [
          "focus",
          {
            type: "choice",
            choice: "answer",
            probabilities: { answer: 0.52, inspect: 0.48 },
          },
        ],
      ]),
      costUsd: 0.00003,
    }));

    const result = await selectStepFocusWithEvaluator(
      baseInput({
        bundles: buildStepFocusBundles(MIXED_TOOLS, READ_ONLY_TOOLS),
        stepIndex: 1,
        stepsInRound: 1,
      }),
      evaluator,
    );

    expect(result.appliedFocus).toBe("answer");
    expect(result.usedFallback).toBe(false);
    expect(result.receipt.validation).toBe("accepted");
  });

  it("catches a stale act pick via execution-time bundle re-check and falls back with zero writes", async () => {
    const evaluator = vi.fn<StepFocusEvaluator>(async () => ({
      answers: new Map([
        [
          "focus",
          {
            type: "choice",
            choice: "act",
            probabilities: { act: 0.92, inspect: 0.05, answer: 0.03 },
          },
        ],
      ]),
      costUsd: 0.00003,
    }));

    const result = await selectStepFocusWithEvaluator(
      baseInput({
        stepIndex: 2,
        stepsInRound: 2,
        recheckBundles: () =>
          buildStepFocusBundles(MIXED_TOOLS, READ_ONLY_TOOLS),
      }),
      evaluator,
    );

    expect(result.appliedFocus).toBe("answer");
    expect(result.usedFallback).toBe(true);
    expect(result.allowedTools).toEqual([]);
    expect(result.toolChoice).toBe("none");
    expect(result.receipt.validation).toBe("stale_bundle");
  });

  it("preserves uncertainty in a failed provider receipt while marking confirmed refusals not done", async () => {
    const { summarizeTurnReceipts } = await import("./done-check");
    toolCallFindManyMock.mockResolvedValueOnce([
      {
        status: "FAILED",
        disposition: "UNKNOWN",
        capability: "publish_social_post",
        targetId: null,
        result: null,
      },
      {
        status: "FAILED",
        disposition: "REJECTED",
        capability: "publish_social_post",
        targetId: null,
        result: null,
      },
    ]);

    const receipts = await summarizeTurnReceipts("turn_uncertain");
    expect(receipts[0]).toMatchObject({
      capability: "publish_social_post",
      outcome: "unconfirmed",
      line: "publish_social_post: Core could not confirm whether it happened",
    });
    expect(receipts[1]).toMatchObject({
      capability: "publish_social_post",
      outcome: "not done",
      line: "publish_social_post: did not happen",
    });

    const { note } = buildVerifyReceiptsNote([receipts[0]!]);
    expect(note).toContain("Core could not confirm whether it happened");
    expect(note).not.toContain("did not happen");
    expect(note).toContain("never call an unconfirmed action failed or done");
  });

  it("rechecks the current menu when a fallback or a single option selects act, and fails closed if writes were revoked", async () => {
    const unchanged = buildStepFocusBundles(MIXED_TOOLS, MIXED_TOOLS);
    const readOnly = buildStepFocusBundles(MIXED_TOOLS, READ_ONLY_TOOLS);

    for (const justExpandedShortForm of [false, true]) {
      const recheckBundles = vi.fn(() => unchanged);
      const result = await selectStepFocusWithEvaluator(
        baseInput({
          bundles: unchanged,
          justExpandedShortForm,
          recheckBundles,
        }),
        async () => ({ costUsd: 0, answers: new Map() }),
      );
      expect(result.appliedFocus).toBe("act");
      expect(recheckBundles).toHaveBeenCalledWith("act");
    }

    // Revoked writes on fallback / single-candidate act must fall back cleanly with zero writes.
    for (const justExpandedShortForm of [false, true]) {
      const recheckBundles = vi.fn(() => readOnly);
      const result = await selectStepFocusWithEvaluator(
        baseInput({
          bundles: unchanged,
          justExpandedShortForm,
          recheckBundles,
        }),
        async () => ({ costUsd: 0, answers: new Map() }),
      );
      expect(recheckBundles).toHaveBeenCalledWith("act");
      expect(result.appliedFocus).toBe("answer");
      expect(result.usedFallback).toBe(true);
      expect(result.allowedTools).toEqual([]);
      expect(result.receipt.validation).toBe("stale_bundle");
    }
  });

  it("keeps paid research (investor_warm_paths) and all Core action-receipt capabilities out of inspect and verify", async () => {
    const {
      ACTION_RECEIPT_CAPABILITIES,
      EXTERNAL_EFFECT_CAPABILITIES,
      isExternalEffectToolCall,
    } = await import("./action-receipts");
    const name: SokoBotCapability = "investor_warm_paths";
    expect(
      isExternalEffectToolCall(name, {
        contactId: "00000000-0000-4000-8000-000000000001",
        research: true,
      }),
    ).toBe(true);
    expect(buildStepFocusBundles([name], [name]).inspect).not.toContain(name);
    expect(buildStepFocusBundles([name], [name]).verify).not.toContain(name);
    expect(buildStepFocusBundles([name], [name]).act).toContain(name);

    for (const cap of [
      ...ACTION_RECEIPT_CAPABILITIES,
      ...EXTERNAL_EFFECT_CAPABILITIES,
    ]) {
      expect(
        STEP_FOCUS_INSPECT_CAPABILITIES.has(cap as SokoBotCapability),
        `${cap} must not be in inspect`,
      ).toBe(false);
      expect(
        STEP_FOCUS_VERIFY_CAPABILITIES.has(cap as SokoBotCapability),
        `${cap} must not be in verify`,
      ).toBe(false);
    }
  });
});

describe("selectTurnStepFocus and recordTurnStepFocusOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeEventFindFirstMock.mockResolvedValue(null);
    runtimeEventCreateMock.mockResolvedValue({});
    toolCallFindManyMock.mockResolvedValue([]);
    pendingDecisionFindFirstMock.mockResolvedValue(null);
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check open tasks and create a draft post.",
      source: "CHAT",
      route: "MANAGE_WORK",
      parentTurnId: null,
    });
  });

  it("returns null for versions without stepFocus enabled", async () => {
    authorizeMock.mockResolvedValue({
      turn: {
        id: "turn_1",
        sokoBotId: "bot_1",
        versionId: "v39",
        source: "CHAT",
        chainDepth: 0,
      },
      grant: { capabilities: ["list_tasks", "create_task"] },
    });
    resolveVersionMock.mockResolvedValue({
      id: "v39",
      profile: "assistant",
      capabilities: ["list_tasks", "create_task"],
    });
    const evaluator = vi.fn<StepFocusEvaluator>();

    const result = await selectTurnStepFocus(
      {
        turnId: "turn_1",
        sessionId: "sess_1",
        sandbox: false,
        stepIndex: 0,
        roundIndex: 0,
        stepsInRound: 0,
        stepsRemaining: 10,
        recentSteps: [],
        hasAttemptedWrite: false,
        consecutiveInspect: 0,
        consecutiveVerify: 0,
        justExpandedShortForm: false,
      },
      evaluator,
    );

    expect(result).toBeNull();
    expect(evaluator).not.toHaveBeenCalled();
    expect(runtimeEventCreateMock).not.toHaveBeenCalled();
  });

  it("re-checks live grants on every step, narrows tools, and persists decision + outcome receipts", async () => {
    authorizeMock.mockResolvedValue({
      turn: {
        id: "turn_1",
        sokoBotId: "bot_1",
        versionId: "v40",
        source: "CHAT",
        chainDepth: 0,
      },
      // Live grant excludes create_task even though fixedToolSet/version offers it.
      grant: { capabilities: ["list_tasks", "read_file"] },
    });
    resolveVersionMock.mockResolvedValue({
      id: "v40",
      profile: "assistant",
      stepFocus: true,
      fixedToolSet: true,
      capabilities: ["list_tasks", "read_file", "create_task"],
    });
    const evaluator = vi.fn<StepFocusEvaluator>(async ({ questions }) => {
      // Host must filter out `act` because live grant has no write tools.
      expect(
        questions.focus?.type === "choice"
          ? Object.keys(questions.focus.criteria)
          : [],
      ).toEqual(["inspect", "answer"]);
      return {
        answers: new Map([
          [
            "focus",
            {
              type: "choice",
              choice: "inspect",
              probabilities: { inspect: 0.9, answer: 0.1 },
            },
          ],
        ]),
        costUsd: 0.00003,
      };
    });

    const selection = await selectTurnStepFocus(
      {
        turnId: "turn_1",
        sessionId: "sess_1",
        sandbox: false,
        stepIndex: 0,
        roundIndex: 0,
        stepsInRound: 0,
        stepsRemaining: 10,
        recentSteps: [],
        hasAttemptedWrite: false,
        consecutiveInspect: 0,
        consecutiveVerify: 0,
        justExpandedShortForm: false,
      },
      evaluator,
    );

    expect(selection).not.toBeNull();
    expect(selection?.appliedFocus).toBe("inspect");
    expect(selection?.allowedTools).toEqual(["list_tasks", "read_file"]);
    expect(selection?.allowedTools).not.toContain("create_task");
    expect(runtimeEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          turnId: "turn_1",
          type: STEP_FOCUS_DECISION_EVENT,
          data: expect.objectContaining({
            kind: "step_focus",
            decisionId: selection?.decisionId,
            candidates: ["inspect", "answer"],
            appliedFocus: "inspect",
            usedFallback: false,
          }),
        }),
      }),
    );

    await recordTurnStepFocusOutcome({
      turnId: "turn_1",
      sessionId: "sess_1",
      outcome: {
        decisionId: selection?.decisionId ?? "",
        stepIndex: 0,
        appliedFocus: "inspect",
        usedFallback: false,
        finishReason: "tool-calls",
        toolCalls: [{ name: "list_tasks", status: "ok" }],
        inputTokens: 1_200,
        outputTokens: 60,
        cacheReadTokens: 800,
      },
    });

    expect(runtimeEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          turnId: "turn_1",
          type: STEP_FOCUS_OUTCOME_EVENT,
          data: expect.objectContaining({
            kind: "step_focus_outcome",
            decisionId: selection?.decisionId,
            inputTokens: 1_200,
          }),
        }),
      }),
    );
  });

  it("re-authorizes live grants before returning a fallback or single-candidate act and fails closed on revocation", async () => {
    resolveVersionMock.mockResolvedValue({
      id: "v40",
      profile: "assistant",
      stepFocus: true,
      capabilities: ["list_tasks", "create_task"],
    });
    authorizeMock
      .mockResolvedValueOnce({
        turn: {
          id: "turn_1",
          sokoBotId: "bot_1",
          versionId: "v40",
          source: "CHAT",
          chainDepth: 0,
        },
        grant: { capabilities: ["list_tasks", "create_task"] },
      })
      .mockResolvedValueOnce({
        turn: {
          id: "turn_1",
          sokoBotId: "bot_1",
          versionId: "v40",
          source: "CHAT",
          chainDepth: 0,
        },
        grant: { capabilities: ["list_tasks"] },
      });

    const selection = await selectTurnStepFocus(
      {
        turnId: "turn_1",
        sessionId: "sess_1",
        sandbox: false,
        stepIndex: 0,
        roundIndex: 0,
        stepsInRound: 0,
        stepsRemaining: 10,
        recentSteps: [],
        hasAttemptedWrite: false,
        consecutiveInspect: 0,
        consecutiveVerify: 0,
        justExpandedShortForm: false,
      },
      // Empty Jev answer triggers fallback -> act, which must still re-authorize.
      async () => ({ answers: new Map(), costUsd: 0 }),
    );

    expect(authorizeMock).toHaveBeenCalledTimes(2);
    expect(selection?.appliedFocus).toBe("answer");
    expect(selection?.usedFallback).toBe(true);
    expect(selection?.allowedTools).toEqual([]);
    expect(selection?.toolChoice).toBe("none");
  });
});
