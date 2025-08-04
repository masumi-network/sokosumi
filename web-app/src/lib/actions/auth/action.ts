"use server";

import { User } from "better-auth";

import {
  ActionError,
  AuthErrorCode,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions";
import { auth } from "@/lib/auth/auth";
import { signUpFormSchema, SignUpFormSchemaType } from "@/lib/schemas";
import { utmService } from "@/lib/services/utm.service";
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

export async function signUpEmail(
  data: SignUpFormSchemaType,
): Promise<Result<User, ActionError>> {
  let actionError: ActionError = {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: "Internal server error",
  };

  try {
    const parsedResult = signUpFormSchema().safeParse(data);
    if (!parsedResult.success) {
      return Err({
        message: "Bad Input",
        code: CommonErrorCode.BAD_INPUT,
      });
    }
    const parsed = parsedResult.data;

    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: parsed.email,
        name: parsed.name,
        password: parsed.password,
        callbackURL: "/",
        termsAccepted: parsed.termsAccepted,
      },
    });
    const user = signUpResult.user;
    if (!user) {
      console.error("Sign up email returned no user");
      actionError = {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Internal server error",
      };
      throw new Error("Internal server error");
    }

    // create utm attribution (after main db transaction is committed)
    // without throwing error if it fails
    try {
      await utmService.handleUTMConversion(user.id);
    } catch (error) {
      console.error("Failed to create utm attribution", error);
    }

    return Ok(user);
  } catch (error) {
    console.error("Failed to sign up email", error);

    const parsedBetterAuthApiErrorResult =
      betterAuthApiErrorSchema.safeParse(error);
    if (parsedBetterAuthApiErrorResult.success) {
      switch (parsedBetterAuthApiErrorResult.data.body.code) {
        case AuthErrorCode.USER_ALREADY_EXISTS:
          actionError = {
            code: AuthErrorCode.USER_ALREADY_EXISTS,
            message: "User already exists",
          };
          break;
      }
    }
    return Err(actionError);
  }
}
