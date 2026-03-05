"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Sentry from "@sentry/nextjs";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import { signInFormData } from "@/auth/signin/data";
import { Badge } from "@/components/ui/badge";
import { AuthErrorCode } from "@/lib/actions";
import { signInEmail } from "@/lib/actions/auth";
import { authClient } from "@/lib/auth/auth.client";
import { FormData } from "@/lib/form";
import { fireGTMEvent } from "@/lib/gtm-events";
import { signInFormSchema, SignInFormSchemaType } from "@/lib/schemas";
import {
  buildOAuthConsentReturnUrlFromSearchParams,
  buildSignUpUrlFromSignIn,
  normalizeAuthReturnUrl,
  waitForAuthSession,
} from "@/lib/utils/auth-redirect";

interface SignInFormProps {
  returnUrl?: string | undefined;
  prefilledEmail?: string | undefined;
}

export default function SignInForm({
  returnUrl,
  prefilledEmail,
}: SignInFormProps) {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const loginAreaFormStart = useRef(false);
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
      rememberMe: false,
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

    const result = await signInEmail(
      {
        email: values.email,
        currentPassword: values.currentPassword,
        rememberMe: values.rememberMe,
      },
      effectiveReturnUrl,
    );

    if (!result.ok) {
      switch (result.error?.code) {
        case AuthErrorCode.TERMS_NOT_ACCEPTED:
          toast.error(t("Errors.termsNotAccepted"));
          break;
        default:
          toast.error(result.error?.message ?? t("error"));
          break;
      }
      return;
    }

    const redirect = result.data.redirect;
    const redirectUrl = result.data.redirectUrl;

    if (redirect && redirectUrl) {
      window.location.href = redirectUrl;
      return;
    }

    await waitForAuthSession({
      context: "login",
      getSession: () => authClient.getSession(),
      logWarning: (message) => {
        Sentry.captureMessage(message, { level: "warning" });
      },
    });

    fireGTMEvent.signIn("credential");
    toast.success(t("success"));
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
  const lastUsedLoginMethod = authClient.getLastUsedLoginMethod();

  return (
    <AuthForm
      form={form}
      formData={formData}
      namespace="Auth.Pages.SignIn.Form"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-4">
        <div className="relative">
          <SubmitButton
            isSubmitting={isSubmitting}
            label={t("submit")}
            className="w-full"
          />
          {lastUsedLoginMethod === "email" && (
            <Badge
              variant="secondary"
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
            >
              {t("lastUsed")}
            </Badge>
          )}
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
          <Link
            href={forgotPasswordUrl}
            className="text-muted-foreground text-sm hover:underline"
          >
            {t("forgotPassword")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
