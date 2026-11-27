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

  it("classifies timeouts as uncertain for mutating tools and transient for read tools", () => {
    const onWrite = classifyThrownToolError(
      new SokoBotToolTimeoutError("create_social_post timed out after 90000ms"),
      "create_social_post",
    );
    const onRead = classifyThrownToolError(
      new SokoBotToolTimeoutError("list_tasks timed out after 90000ms"),
      "list_tasks",
    );
    expect(onWrite.kind).toBe("uncertain");
    expect(onWrite.retryable).toBe(false);
    expect(onRead.kind).toBe("transient");
    expect(onRead.retryable).toBe(true);
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
});
