import type { ActionResultDto } from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import type { AdminUserOption } from "@/lib/clients/generated/core";

/** The impersonated (start) or restored admin (stop) user: a Core DTO. */
export type ImpersonationUser = AdminUserOption;

export type ImpersonationResult = ActionResultDto<
  ImpersonationUser,
  ActionError
>;

export interface StartImpersonationInput {
  userId: string;
  reason: string;
}

const IMPERSONATION_ROUTE = "/api/admin/impersonation";

function isImpersonationResult(value: unknown): value is ImpersonationResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok: unknown }).ok === "boolean"
  );
}

function transportFailure(): ImpersonationResult {
  return {
    ok: false,
    error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR },
  };
}

async function requestImpersonation(
  method: "POST" | "DELETE",
  body?: StartImpersonationInput,
): Promise<ImpersonationResult> {
  let response: Response;
  try {
    response = await fetch(IMPERSONATION_ROUTE, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return transportFailure();
  }
  const dto: unknown = await response.json().catch(() => null);
  if (!isImpersonationResult(dto)) {
    return transportFailure();
  }
  return dto;
}

/** Starts impersonation; on success the browser holds the target session. */
export function startImpersonation(
  input: StartImpersonationInput,
): Promise<ImpersonationResult> {
  return requestImpersonation("POST", input);
}

/** Stops impersonation; on success the admin session is restored. */
export function stopImpersonation(): Promise<ImpersonationResult> {
  return requestImpersonation("DELETE");
}
