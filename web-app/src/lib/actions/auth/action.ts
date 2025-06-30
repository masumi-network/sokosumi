"use server";

import { err, ok, Result } from "neverthrow";

import { ActionError, CommonErrorCode } from "@/lib/actions/types";
import { auth } from "@/lib/auth/auth";

export async function signInSocial(
  provider: "google" | "microsoft" | "apple" | "linkedin",
): Promise<Result<void, ActionError>> {
  try {
    await auth.api.signInSocial({
      body: {
        provider: provider,
      },
    });
    return ok();
  } catch (error) {
    console.error("Error signing in with social provider", error);
    return err(
      new ActionError(
        "Internal server error",
        CommonErrorCode.INTERNAL_SERVER_ERROR,
      ),
    );
  }
}
