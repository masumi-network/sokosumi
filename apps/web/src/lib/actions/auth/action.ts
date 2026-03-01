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
  signInFormSchema,
  SignInFormSchemaType,
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
  callbackURL?: string,
): Promise<Result<SignUpEmailResult, ActionError>> {
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

    const safeCallbackURL =
      callbackURL &&
      callbackURL.startsWith("/") &&
      !callbackURL.startsWith("//")
        ? callbackURL
        : "/";

    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: parsed.email,
        name: parsed.name,
        password: parsed.password,
        callbackURL: safeCallbackURL,
        marketingOptIn: parsed.marketingOptIn,
        termsAccepted: parsed.termsAccepted,
        onboardingCompleted: false,
      },
      headers: await headers(),
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

    const oauthResponse = signUpResult as {
      redirect?: boolean;
      url?: string;
      data?: {
        redirect?: boolean;
        url?: string;
      };
    };
    const redirect = oauthResponse.redirect ?? oauthResponse.data?.redirect;
    const redirectUrl = oauthResponse.url ?? oauthResponse.data?.url;

    return Ok({
      user,
      redirect,
      redirectUrl,
    });
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

export async function signInEmail(
  data: SignInFormSchemaType,
): Promise<Result<SignInEmailResult, ActionError>> {
  const parsedResult = signInFormSchema().safeParse(data);
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  const parsed = parsedResult.data;

  try {
    const signInResult = await auth.api.signInEmail({
      body: {
        email: parsed.email,
        password: parsed.currentPassword,
        rememberMe: parsed.rememberMe,
      },
      headers: await headers(),
    });

    const oauthResponse = signInResult as {
      redirect?: boolean;
      url?: string;
      data?: {
        redirect?: boolean;
        url?: string;
      };
    };
    const redirect = oauthResponse.redirect ?? oauthResponse.data?.redirect;
    const redirectUrl = oauthResponse.url ?? oauthResponse.data?.url;

    if (redirect && redirectUrl) {
      return Ok({
        redirect: true,
        redirectUrl,
      });
    }

    return Ok({
      redirect: false,
    });
  } catch (error) {
    console.error("Failed to sign in email", error);

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

interface SignUpEmailResult {
  user: User;
  redirect?: boolean;
  redirectUrl?: string;
}

interface SignInEmailResult {
  redirect: boolean;
  redirectUrl?: string;
}
