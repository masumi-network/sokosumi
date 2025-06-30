"use server";

import { ActionError, CommonErrorCode } from "@/lib/actions/types";
import { auth } from "@/lib/auth/auth";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function signInSocial(
  provider: "google" | "microsoft" | "apple" | "linkedin",
): Promise<Result<void, ActionError>> {
  try {
    await auth.api.signInSocial({
      body: {
        provider: provider,
      },
    });
    return Ok();
  } catch (error) {
    console.error("Error signing in with social provider", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
