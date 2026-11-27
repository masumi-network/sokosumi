import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  CoreRejected,
  classifyCoreToolError,
  classifyRunnerToolError,
  formatToolErrorRecoveryNote,
  isTypedToolErrorPayload,
  isUncertainToolOutcome,
  markUncertainToolOutcome,
  TOOL_ERROR_CLASSES,
  TOOL_ERROR_RECOVERY_RULES,
  TypedToolError,
} from "./tool-errors";

describe("classifyCoreToolError", () => {
  it("defines a safe recovery rule for every general failure class", () => {
    for (const kind of TOOL_ERROR_CLASSES) {
      const rule = TOOL_ERROR_RECOVERY_RULES[kind];
      expect(rule.hint.length).toBeGreaterThan(20);
      expect(typeof rule.retryable).toBe("boolean");
    }
    expect(TOOL_ERROR_RECOVERY_RULES.forbidden.retryable).toBe(false);
    expect(TOOL_ERROR_RECOVERY_RULES.uncertain.retryable).toBe(false);
    expect(TOOL_ERROR_RECOVERY_RULES.conflict.retryable).toBe(true);
    expect(TOOL_ERROR_RECOVERY_RULES.busy.retryable).toBe(true);
    expect(TOOL_ERROR_RECOVERY_RULES.not_found.retryable).toBe(true);
    expect(TOOL_ERROR_RECOVERY_RULES.invalid_input.retryable).toBe(true);
    expect(TOOL_ERROR_RECOVERY_RULES.transient.retryable).toBe(true);
  });

  it.each([
    [
      "table conflict (HTTP 409)",
      { status: 409, message: "Table identifier already exists" },
      "conflict",
      true,
    ],
    [
      "revision conflict core kind",
      {
        status: 409,
        kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
        message: "Social post changed",
      },
      "conflict",
      true,
    ],
    [
      "image studio busy kind",
      {
        status: 429,
        kind: "image_studio_project_busy",
        message: "This project already has 3 images being generated.",
      },
      "busy",
      true,
    ],
    [
      "generic HTTP 429",
      { status: 429, message: "Too many concurrent jobs" },
      "busy",
      true,
    ],
    [
      "hourly rate limit kind stays non-retryable forbidden",
      {
        status: 429,
        kind: "image_studio_rate_limited",
        message: "You can start at most 20 image generations per hour.",
      },
      "forbidden",
      false,
    ],
    [
      "not found (HTTP 404)",
      { status: 404, message: "Social post not found" },
      "not_found",
      true,
    ],
    [
      "forbidden (HTTP 403)",
      { status: 403, message: "Not permitted" },
      "forbidden",
      false,
    ],
    [
      "insufficient balance (HTTP 402)",
      {
        status: 402,
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
        message: "Not enough credits",
      },
      "forbidden",
      false,
    ],
    [
      "invalid input (HTTP 400)",
      { status: 400, message: "timezone is required when scheduling" },
      "invalid_input",
      true,
    ],
    [
      "invalid input (HTTP 422)",
      { status: 422, message: "Key: title - Required" },
      "invalid_input",
      true,
    ],
    [
      "serializable concurrency conflict is transient even for mutating writes",
      {
        status: 409,
        kind: CORE_API_ERROR_KINDS.CONCURRENCY_CONFLICT,
        message: "Transaction serialization conflict",
        mutating: true,
      },
      "transient",
      true,
    ],
    [
      "503 on a read tool is transient",
      { status: 503, message: "Upstream unavailable", mutating: false },
      "transient",
      true,
    ],
    [
      "503 on a mutating tool is uncertain (never blindly retried)",
      { status: 503, message: "Upstream unavailable", mutating: true },
      "uncertain",
      false,
    ],
    [
      "explicit uncertain flag always wins over transient status",
      {
        status: 502,
        message: "Provider disconnected mid-dispatch",
        uncertain: true,
        mutating: true,
      },
      "uncertain",
      false,
    ],
    [
      "tool-call limit conflict maps to forbidden",
      {
        errorName: "SokoBotRuntimeConflictError",
        message: "Soko Bot turn tool-call limit reached",
        mutating: true,
      },
      "forbidden",
      false,
    ],
    [
      "already-executing conflict maps to busy",
      {
        errorName: "SokoBotRuntimeConflictError",
        message: "Tool call is already executing",
        mutating: true,
      },
      "busy",
      true,
    ],
    [
      "unknown-outcome conflict maps to uncertain",
      {
        errorName: "SokoBotRuntimeConflictError",
        message:
          "Effect outcome is unknown; reconciliation is required before retrying",
        mutating: true,
      },
      "uncertain",
      false,
    ],
  ])("maps %s to %s", (_label, input, expectedKind, expectedRetryable) => {
    const result = classifyCoreToolError(input);
    expect(result.kind).toBe(expectedKind);
    expect(result.retryable).toBe(expectedRetryable);
    expect(result.hint).toBe(TOOL_ERROR_RECOVERY_RULES[result.kind].hint);
  });

  it("tracks uncertain outcomes through error cause chains", () => {
    const root = markUncertainToolOutcome(new Error("provider reset"));
    const wrapped = new Error("outer", { cause: root });
    expect(isUncertainToolOutcome(root)).toBe(true);
    expect(isUncertainToolOutcome(wrapped)).toBe(true);
    expect(isUncertainToolOutcome(new Error("plain"))).toBe(false);
  });
});

describe("classifyRunnerToolError & CoreRejected preservation", () => {
  it("preserves CoreRejected status and kind when Core did not send toolError", () => {
    const rejected = new CoreRejected(
      "Table identifier already exists",
      409,
      CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_TAKEN,
    );
    const typed = classifyRunnerToolError(rejected, "create_table");
    expect(typed).toBeInstanceOf(TypedToolError);
    expect(typed.payload.kind).toBe("conflict");
    expect(typed.payload.status).toBe(409);
    expect(typed.payload.coreKind).toBe(
      CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_TAKEN,
    );
    expect(typed.payload.retryable).toBe(true);
    expect(typed.cause).toBe(rejected);
  });

  it("uses Core's classified toolError payload when Core sent one", () => {
    const corePayload = classifyCoreToolError({
      status: 429,
      kind: "image_studio_project_busy",
      message: "This project already has 3 images being generated.",
    });
    const rejected = new CoreRejected(
      corePayload.message,
      422,
      "image_studio_project_busy",
      corePayload,
    );
    const typed = classifyRunnerToolError(rejected, "generate_image");
    expect(typed.payload).toEqual(corePayload);
  });

  it("marks lost responses as uncertain for writes and paid calls, and transient for free reads", () => {
    const contactId = "0196a001-0001-7001-8001-000000000011";
    const taskId = "0196a001-0001-7001-8001-000000000022";
    const lostResponses = [
      new TypeError("fetch failed"),
      Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
      new CoreRejected("Bad Gateway", 502),
    ];

    const paidOrMutatingCalls: readonly [string, unknown][] = [
      ["find_investors", { query: "seed fintech" }],
      ["find_people", { query: "VP Engineering" }],
      ["enrich_contact", { contactId }],
      ["investor_warm_paths", { contactId, research: true }],
      ["investor_warm_paths", undefined],
      ["investor_warm_paths", {}],
      ["generate_image", { prompt: "banner" }],
      ["generate_video", { prompt: "demo" }],
      ["generate_talking_video", { prompt: "intro" }],
      ["generate_voiceover", { text: "hello" }],
      ["hire_agent", { agentId: "agent_1" }],
      ["provide_job_input", { jobId: "job_1" }],
      ["create_ad_campaign", { name: "Launch" }],
      ["update_ad_campaign", { campaignId: "123" }],
      ["search_exa", { query: "pricing" }],
      ["web_search", { query: "pricing" }],
      ["research_keywords", { topic: "crm" }],
      ["research_competitor_keywords", {}],
      ["check_search_rankings", { keywords: ["crm"] }],
      ["request_seo_analysis", { kind: "audit_full" }],
      ["evaluate_with_jev", { text: "draft" }],
      ["create_social_post", { text: "launch" }],
      ["future_unlisted_paid_tool", { query: "anything" }],
    ];

    const freeReadControls: readonly [string, unknown][] = [
      ["get_task_status", { taskId }],
      ["investor_warm_paths", { contactId, research: false }],
      ["investor_warm_paths", { contactId }],
      ["list_tables", {}],
    ];

    for (const error of lostResponses) {
      for (const [capability, input] of paidOrMutatingCalls) {
        const typed = classifyRunnerToolError(error, capability, input);
        expect(typed.payload.kind, `${capability} (${error.name})`).toBe(
          "uncertain",
        );
        expect(typed.payload.retryable, `${capability} (${error.name})`).toBe(
          false,
        );
        expect(typed.payload.hint).toMatch(/read back/i);
      }

      for (const [capability, input] of freeReadControls) {
        const typed = classifyRunnerToolError(error, capability, input);
        expect(typed.payload.kind, `${capability} (${error.name})`).toBe(
          "transient",
        );
        expect(typed.payload.retryable, `${capability} (${error.name})`).toBe(
          true,
        );
      }
    }
  });

  it("validates serialized toolError payloads strictly", () => {
    const valid = classifyCoreToolError({
      status: 404,
      message: "Not found",
    });
    expect(isTypedToolErrorPayload(valid)).toBe(true);
    expect(isTypedToolErrorPayload({ kind: "made_up", retryable: true })).toBe(
      false,
    );
    expect(isTypedToolErrorPayload(null)).toBe(false);
  });

  it("formats a fresh recovery note labeled from Core with kind, retryable, and hint", () => {
    const payload = classifyCoreToolError({
      status: 409,
      message: "Table identifier already exists",
    });
    const note = formatToolErrorRecoveryNote([
      { toolName: "create_table", payload },
    ]);
    expect(note).toContain(
      "Tool error recovery note (from Core, not the owner):",
    );
    expect(note).toContain('"kind":"conflict"');
    expect(note).toContain('"retryable":true');
    expect(note).toContain(JSON.stringify(payload.hint));
  });
});
