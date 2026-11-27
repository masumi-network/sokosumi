import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  badGateway,
  conflict,
  forbidden,
  notFound,
  paymentRequired,
  tooManyRequests,
} from "@/helpers/error";
import {
  SokoBotFeatureOffError,
  SokoBotImageRefusedError,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
} from "@/services/soko-bot-runtime.service";
import {
  classifyThrownToolError,
  toSandboxToolHttpException,
  toTypedToolError,
} from "./core-tool-error";
import { markUncertainToolOutcome, TypedToolError } from "./tool-errors";
import {
  SokoBotTaintedActionError,
  SokoBotToolNotOpenError,
  SokoBotToolTimeoutError,
} from "./turn-loop";

describe("classifyThrownToolError", () => {
  it("keeps 409 conflict status from data-table conflict errors", () => {
    const payload = classifyThrownToolError(
      conflict("Table identifier already exists"),
      "create_table",
    );
    expect(payload.kind).toBe("conflict");
    expect(payload.status).toBe(409);
    expect(payload.retryable).toBe(true);
  });

  it("unwraps HTTPException cause through SokoBotImageRefusedError for busy studio jobs", () => {
    const wrapped = new SokoBotImageRefusedError(
      "This project already has 3 images being generated. Wait for one to finish.",
      {
        cause: tooManyRequests(
          "This project already has 3 images being generated. Wait for one to finish.",
          { kind: "image_studio_project_busy" },
        ),
      },
    );
    const payload = classifyThrownToolError(wrapped, "generate_image");
    expect(payload.kind).toBe("busy");
    expect(payload.status).toBe(429);
    expect(payload.coreKind).toBe("image_studio_project_busy");
    expect(payload.retryable).toBe(true);
  });

  it("unwraps 402 insufficient_balance cause to forbidden", () => {
    const wrapped = new SokoBotImageRefusedError("Not enough credits", {
      cause: paymentRequired("Not enough credits", {
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
      }),
    });
    const payload = classifyThrownToolError(wrapped, "generate_image");
    expect(payload.kind).toBe("forbidden");
    expect(payload.status).toBe(402);
    expect(payload.retryable).toBe(false);
  });

  it("unwraps 404 notFound cause through SokoBotRefusedUnsentError", () => {
    const wrapped = new SokoBotRefusedUnsentError("Contact not found", {
      cause: notFound("Contact not found"),
    });
    const payload = classifyThrownToolError(wrapped, "update_contact");
    expect(payload.kind).toBe("not_found");
    expect(payload.status).toBe(404);
    expect(payload.retryable).toBe(true);
  });

  it("maps authorization, taint, feature-off, and not-open errors to forbidden", () => {
    for (const error of [
      new SokoBotRuntimeAuthorizationError("Owner only"),
      new SokoBotTaintedActionError("post_chat"),
      new SokoBotFeatureOffError("Fundraising is off"),
      new SokoBotToolNotOpenError("not open"),
    ]) {
      const payload = classifyThrownToolError(error, "post_chat");
      expect(payload.kind).toBe("forbidden");
      expect(payload.retryable).toBe(false);
    }
  });

  it("formats ZodError as invalid_input with field path", () => {
    const parsed = z.object({ title: z.string().min(1) }).safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const payload = classifyThrownToolError(parsed.error, "create_table");
    expect(payload.kind).toBe("invalid_input");
    expect(payload.retryable).toBe(true);
    expect(payload.message).toContain("title");
  });

  it("classifies timeouts and lost responses as uncertain for paid or mutating calls and transient for read-only controls", () => {
    const contactId = "0196a001-0001-7001-8001-000000000011";
    const taskId = "0196a001-0001-7001-8001-000000000022";
    const timeout = new SokoBotToolTimeoutError("tool timed out after 90000ms");
    const gatewayError = badGateway("Upstream disconnected");

    const paidOrMutating: readonly [string, unknown][] = [
      ["investor_warm_paths", { contactId, research: true }],
      ["investor_warm_paths", undefined],
      ["find_investors", { query: "seed fintech" }],
      ["find_people", { query: "VP Engineering" }],
      ["generate_image", { prompt: "banner" }],
      ["generate_video", { prompt: "demo" }],
      ["hire_agent", { agentId: "agent_1" }],
      ["create_ad_campaign", { name: "Launch" }],
      ["search_exa", { query: "pricing" }],
      ["research_keywords", { topic: "crm" }],
      ["request_seo_analysis", { kind: "audit_full" }],
      ["create_social_post", { text: "launch" }],
    ];

    for (const error of [timeout, gatewayError]) {
      for (const [capability, input] of paidOrMutating) {
        const payload = classifyThrownToolError(error, capability, input);
        expect(payload.kind, `${capability} (${error.name})`).toBe("uncertain");
        expect(payload.retryable, `${capability} (${error.name})`).toBe(false);
        expect(payload.hint).toMatch(/read back/i);
      }

      for (const [capability, input] of [
        ["get_task_status", { taskId }],
        ["list_tasks", {}],
        ["investor_warm_paths", { contactId, research: false }],
        ["investor_warm_paths", { contactId }],
      ] as const) {
        const payload = classifyThrownToolError(error, capability, input);
        expect(payload.kind, `${capability} (${error.name})`).toBe("transient");
        expect(payload.retryable, `${capability} (${error.name})`).toBe(true);
      }
    }
  });

  it("keeps explicitly marked uncertain outcomes uncertain even for 502 errors", () => {
    const error = markUncertainToolOutcome(badGateway("Provider dropped"));
    const payload = classifyThrownToolError(error, "generate_image");
    expect(payload.kind).toBe("uncertain");
    expect(payload.retryable).toBe(false);
  });

  it("wraps cleanly into TypedToolError idempotently", () => {
    const typed = toTypedToolError(forbidden("Denied"), "create_task");
    expect(typed).toBeInstanceOf(TypedToolError);
    expect(toTypedToolError(typed, "create_task")).toBe(typed);
  });
});

describe("toSandboxToolHttpException", () => {
  it("leaves SOKO_BOT_TURN_INACTIVE untouched so the runner aborts", () => {
    const inactive = conflict("Turn is not active", {
      kind: CORE_API_ERROR_KINDS.SOKO_BOT_TURN_INACTIVE,
    });
    expect(toSandboxToolHttpException(inactive, "create_table")).toBe(inactive);
  });

  it("preserves HTTP status and kind while attaching toolError extension", () => {
    const http = toSandboxToolHttpException(
      conflict("Table identifier already exists"),
      "create_table",
    );
    expect(http.status).toBe(409);
    const cause = http.cause as { extensions?: { toolError?: unknown } };
    expect(cause.extensions?.toolError).toMatchObject({
      kind: "conflict",
      status: 409,
      retryable: true,
    });
  });

  it("keeps 422 for non-HTTPException errors while carrying underlying kind and toolError", () => {
    const wrapped = new SokoBotImageRefusedError("3 images in progress", {
      cause: tooManyRequests("3 images in progress", {
        kind: "image_studio_project_busy",
      }),
    });
    const http = toSandboxToolHttpException(wrapped, "generate_image");
    expect(http.status).toBe(422);
    const cause = http.cause as {
      kind?: string;
      extensions?: { toolError?: unknown };
    };
    expect(cause.kind).toBe("image_studio_project_busy");
    expect(cause.extensions?.toolError).toMatchObject({
      kind: "busy",
      status: 429,
      coreKind: "image_studio_project_busy",
      retryable: true,
    });
  });

  it("uses tool input when classifying sandbox HTTP timeouts on investor_warm_paths", () => {
    const contactId = "0196a001-0001-7001-8001-000000000011";
    const timeout = new SokoBotToolTimeoutError(
      "investor_warm_paths timed out after 90000ms",
    );
    const paidHttp = toSandboxToolHttpException(
      timeout,
      "investor_warm_paths",
      { contactId, research: true },
    );
    const readHttp = toSandboxToolHttpException(
      timeout,
      "investor_warm_paths",
      { contactId, research: false },
    );

    expect(
      (paidHttp.cause as { extensions?: { toolError?: unknown } }).extensions
        ?.toolError,
    ).toMatchObject({ kind: "uncertain", retryable: false });
    expect(
      (readHttp.cause as { extensions?: { toolError?: unknown } }).extensions
        ?.toolError,
    ).toMatchObject({ kind: "transient", retryable: true });
  });
});
