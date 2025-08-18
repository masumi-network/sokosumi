"use server";

import { User } from "better-auth";
import { headers } from "next/headers";

import {
  ActionError,
  AuthErrorCode,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions";
import { auth } from "@/lib/auth/auth";
import {
  newPasswordFormSchema,
  NewPasswordFormType,
  signUpFormSchema,
  SignUpFormSchemaType,
} from "@/lib/schemas";
import { utmService } from "@/lib/services/utm.service";
import { Err, Ok, Result } from "@/lib/ts-res";

/**
 * Creates a credential account for the user.
 * This is used for social signed up users to set up a password.
 * @param data - The data for the new password.
 * @returns The user if the account was created successfully, otherwise an error.
 */
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

export async function signUpEmail(
  data: SignUpFormSchemaType,
): Promise<Result<User, ActionError>> {
  let actionError: ActionError = {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
  };

  try {
    const parsedResult = signUpFormSchema().safeParse(data);
    if (!parsedResult.success) {
      return Err({
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
        case AuthErrorCode.EMAIL_DOMAIN_NOT_ALLOWED:
          actionError = {
            code: AuthErrorCode.EMAIL_DOMAIN_NOT_ALLOWED,
          };
          break;
        case AuthErrorCode.TERMS_NOT_ACCEPTED:
          actionError = {
            code: AuthErrorCode.TERMS_NOT_ACCEPTED,
          };
          break;
        default:
          actionError = {
            code: parsedBetterAuthApiErrorResult.data.body.code,
            message: parsedBetterAuthApiErrorResult.data.body.message,
          };
      }
    }
    return Err(actionError);
  }
}
