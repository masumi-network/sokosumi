"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Sentry from "@sentry/nextjs";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import { signInFormData } from "@/auth/signin/data";
import { AuthErrorCode } from "@/lib/actions";
import { authClient, signIn } from "@/lib/auth/auth.client";
import {
  buildOAuthConsentReturnUrlFromSearchParams,
  buildSignUpUrlFromSignIn,
  createAuthSessionGetter,
  getAbsoluteAuthRedirectUrl,
  getAuthOAuthRedirect,
  normalizeAuthReturnUrl,
  waitForAuthSession,
} from "@/lib/auth/auth.utils";
import type { FormData } from "@/lib/form";
import { fireGTMEvent } from "@/lib/gtm-events";
import { type SignInFormSchemaType, signInFormSchema } from "@/lib/schemas";

interface SignInFormProps {
  returnUrl?: string | undefined;
  prefilledEmail?: string | undefined;
  isLastUsedEmailLogin?: boolean;
}

export default function SignInForm({
  returnUrl,
  prefilledEmail,
  isLastUsedEmailLogin = false,
}: SignInFormProps) {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const loginAreaFormStart = useRef(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthConsentReturnUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(
      signInFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: prefilledEmail ?? "",
      currentPassword: "",
      // Persistent session cookie (Max-Age). false → Better Auth omits Max-Age;
      // iOS then drops the cookie when it kills the PWA after backgrounding.
      rememberMe: true,
    },
  });

  // when user first sees the register page
  useEffect(() => {
    fireGTMEvent.viewLoginArea();
  }, []);

  // when user starts typing in the form
  useEffect(() => {
    if (loginAreaFormStart.current) return;
    if (form.formState.isDirty) {
      loginAreaFormStart.current = true;
      fireGTMEvent.loginAreaFormStart();
    }
  }, [form.formState.isDirty]);

  const handleSubmit = async (values: SignInFormSchemaType) => {
    track("Sign In", { provider: "credential" });

    const result = await signIn.email({
      email: values.email,
      password: values.currentPassword,
      rememberMe: values.rememberMe,
      callbackURL: getAbsoluteAuthRedirectUrl(effectiveReturnUrl, "/"),
    });

    if (result.error) {
      const errorCode = "code" in result.error ? result.error.code : undefined;

      switch (errorCode) {
        case AuthErrorCode.TERMS_NOT_ACCEPTED:
          toast.error(t("Errors.termsNotAccepted"));
          break;
        default:
          toast.error(result.error.message ?? t("error"));
          break;
      }
      return;
    }

    const oauthRedirect = getAuthOAuthRedirect(result.data);
    if (oauthRedirect.redirect && oauthRedirect.redirectUrl) {
      setIsLeaving(true);
      window.location.href = oauthRedirect.redirectUrl;
      return;
    }

    await waitForAuthSession({
      context: "login",
      getSession: createAuthSessionGetter(() => authClient.getSession()),
      logWarning: (message) => {
        Sentry.captureMessage(message, { level: "warning" });
      },
    });

    fireGTMEvent.signIn("credential");
    toast.success(t("success"));
    setIsLeaving(true);
    router.replace(normalizeAuthReturnUrl(effectiveReturnUrl));
  };

  const email = useWatch({
    control: form.control,
    name: "email",
  });
  const formData: FormData<SignInFormSchemaType, "Auth.Pages.SignIn.Form"> =
    signInFormData.map((item) =>
      item.name === "email" && prefilledEmail
        ? { ...item, disabled: true }
        : item,
    );
  const forgotPasswordUrl = useMemo(
    () =>
      `/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`,
    [email],
  );
  const signUpUrl = useMemo(
    () =>
      buildSignUpUrlFromSignIn({
        returnUrl: effectiveReturnUrl,
        email: prefilledEmail ?? email,
      }),
    [effectiveReturnUrl, prefilledEmail, email],
  );

  const { isSubmitting } = form.formState;
  const isPending = isSubmitting || isLeaving;

  return (
    <AuthForm
      form={form}
      formData={formData}
      namespace="Auth.Pages.SignIn.Form"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-4">
        <div className="relative">
          {isLastUsedEmailLogin && (
            <span
              aria-hidden="true"
              className="bg-background text-foreground border-border pointer-events-none absolute top-1/2 right-2 z-10 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[0.625rem] font-medium"
            >
              {t("lastUsed")}
            </span>
          )}
          <SubmitButton
            isSubmitting={isPending}
            spinnerPosition="start"
            label={t("submit")}
            className="w-full"
            data-testid="auth-submit"
          />
        </div>
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <div className="flex flex-row items-center gap-2">
            <span className="text-muted-foreground text-sm">
              {t("Register.message")}
            </span>
            <Link
              href={signUpUrl}
              className="text-primary text-sm font-medium hover:underline"
            >
              {t("Register.link")}
            </Link>
          </div>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            <Link
              href={forgotPasswordUrl}
              className="text-muted-foreground text-sm hover:underline"
            >
              {t("forgotPassword")}
            </Link>
          </div>
        </div>
      </div>
    </AuthForm>
  );
}
