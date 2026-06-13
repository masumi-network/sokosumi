"use server";

import { headers } from "next/headers";

import {
  type ActionError,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions/errors";
import { auth } from "@/lib/auth/auth";
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
    await auth.api.setPassword({
      body: {
        newPassword: parsed.newPassword,
      },
      headers: await headers(),
    });
    return Ok();
  } catch (error) {
    console.error("Failed to set password", error);

    const parsedBetterAuthApiErrorResult =
      betterAuthApiErrorSchema.safeParse(error);
    if (parsedBetterAuthApiErrorResult.success) {
      return Err({
        code: parsedBetterAuthApiErrorResult.data.body.code,
        message: parsedBetterAuthApiErrorResult.data.body.message,
      });
    }

    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function handleUtmConversion(): Promise<void> {
  try {
    await utmService.handleUTMConversion();
  } catch (error) {
    console.error("Failed to create utm attribution", error);
  }
}
