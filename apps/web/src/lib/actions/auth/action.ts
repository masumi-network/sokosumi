"use server";

import { err, ok } from "neverthrow";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  resetPasswordViaCore,
  setPasswordViaCore,
} from "@/lib/auth/core-auth-http.server";
import {
  clearResetPasswordToken,
  getResetPasswordToken,
} from "@/lib/reset-password-token-cookie";
import {
  type NewPasswordFormType,
  newPasswordFormSchema,
} from "@/lib/schemas/account";
import {
  type ResetPasswordFormSchemaType,
  resetPasswordFormSchema,
} from "@/lib/schemas/auth";
import { utmService } from "@/lib/services/utm.service";

export async function createCredentialAccount(
  data: NewPasswordFormType,
): Promise<ActionResultDto<void, ActionError>> {
  const parsedResult = newPasswordFormSchema().safeParse(data);
  if (!parsedResult.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
      }),
    );
  }
  const parsed = parsedResult.data;

  try {
    await setPasswordViaCore(parsed.newPassword);
    return toActionResult(ok());
  } catch (error) {
    console.error("Failed to set password", error);

    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;

    // Only surface a message for known (coded) auth errors. Generic infra
    // failures (timeouts, fetch errors) must not leak their raw message.
    if (code) {
      return toActionResult(
        err({
          code,
          ...(error instanceof Error && error.message
            ? { message: error.message }
            : {}),
        }),
      );
    }

    return toActionResult(err({ code: CommonErrorCode.INTERNAL_SERVER_ERROR }));
  }
}

export async function resetPasswordWithToken(
  data: ResetPasswordFormSchemaType,
): Promise<ActionResultDto<void, ActionError>> {
  const parsedResult = resetPasswordFormSchema().safeParse(data);
  if (!parsedResult.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  const token = await getResetPasswordToken();
  if (!token) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    await resetPasswordViaCore(parsedResult.data.password, token);
    await clearResetPasswordToken();
    return toActionResult(ok());
  } catch (error) {
    console.error("Failed to reset password", error);
    return toActionResult(err({ code: CommonErrorCode.INTERNAL_SERVER_ERROR }));
  }
}

export async function handleUtmConversion(): Promise<void> {
  try {
    await utmService.handleUTMConversion();
  } catch (error) {
    console.error("Failed to create utm attribution", error);
  }
}
