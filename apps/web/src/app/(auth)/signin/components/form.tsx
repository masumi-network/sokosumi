"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Sentry from "@sentry/nextjs";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import { signInFormData } from "@/auth/signin/data";
import { AuthErrorCode } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import { FormData } from "@/lib/form";
import { fireGTMEvent } from "@/lib/gtm-events";
import { signInFormSchema, SignInFormSchemaType } from "@/lib/schemas";

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

    const result = await authClient.signIn.email({
      email: values.email,
      password: values.currentPassword,
      rememberMe: values.rememberMe,
    });

    if (result.error) {
      switch (result.error.code) {
        case AuthErrorCode.TERMS_NOT_ACCEPTED:
          toast.error(t("Errors.termsNotAccepted"));
          break;
        default:
          toast.error(result.error.message ?? t("error"));
          break;
      }
      return;
    }

    // Wait a moment for session to be established
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify session is available before redirecting
    const session = await authClient.getSession();
    if (!session) {
      Sentry.captureMessage(
        "Session not established after login, waiting for 500ms",
        {
          level: "warning",
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const retrySession = await authClient.getSession();
      if (!retrySession) {
        Sentry.captureMessage(
          "Session not established after login, proceeding with redirect anyway",
          {
            level: "warning",
          },
        );
      }
    }

    fireGTMEvent.login();
    toast.success(t("success"));

    // Redirect to the original URL if provided, otherwise go to /agents
    // Validate returnUrl to prevent open redirect attacks
    let redirectUrl = "/agents";
    if (returnUrl) {
      try {
        // Only allow relative URLs or URLs from the same origin
        const url = new URL(returnUrl, window.location.origin);
        if (url.origin === window.location.origin) {
          redirectUrl = returnUrl;
        }
      } catch {
        // Invalid URL, fallback to /agents
      }
    }

    // Use window.location.href for hard navigation to ensure cookies are properly sent
    window.location.href = redirectUrl;
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

  const { isSubmitting } = form.formState;

  return (
    <AuthForm
      form={form}
      formData={formData}
      namespace="Auth.Pages.SignIn.Form"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-4">
        <SubmitButton
          isSubmitting={isSubmitting}
          label={t("submit")}
          className="w-full"
        />
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <div className="flex flex-row items-center gap-2">
            <span className="text-muted-foreground text-sm">
              {t("Register.message")}
            </span>
            <Link
              href="/signup"
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
