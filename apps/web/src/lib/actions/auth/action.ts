"use server";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { setPasswordViaCore } from "@/lib/auth/core-auth-http.server";
import { type NewPasswordFormType, newPasswordFormSchema } from "@/lib/schemas";
import { utmService } from "@/lib/services/utm.service";
import { Err, Ok, type Result } from "@/lib/ts-res";

export async function createCredentialAccount(
  data: NewPasswordFormType,
): Promise<Result<void, ActionError>> {
  const parsedResult = newPasswordFormSchema().safeParse(data);
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }
  const parsed = parsedResult.data;

  try {
    await setPasswordViaCore(parsed.newPassword);
    return Ok();
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
      return Err({
        code,
        ...(error instanceof Error && error.message
          ? { message: error.message }
          : {}),
      });
    }

    return Err({ code: CommonErrorCode.INTERNAL_SERVER_ERROR });
  }
}

export async function handleUtmConversion(): Promise<void> {
  try {
    await utmService.handleUTMConversion();
  } catch (error) {
    console.error("Failed to create utm attribution", error);
  }
}
