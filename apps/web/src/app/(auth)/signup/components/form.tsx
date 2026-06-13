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
import { signUpFormData } from "@/auth/signup/data";
import { AuthErrorCode, signUpEmail } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import {
  buildOAuthConsentReturnUrlFromSearchParams,
  createAuthSessionGetter,
  normalizeAuthReturnUrl,
  waitForAuthSession,
} from "@/lib/auth/auth.utils";
import type { FormData } from "@/lib/form";
import { fireGTMEvent } from "@/lib/gtm-events";
import { type SignUpFormSchemaType, signUpFormSchema } from "@/lib/schemas";

interface SignUpFormProps {
  prefilledEmail?: string | undefined;
  returnUrl?: string | undefined;
}

export default function SignUpForm({
  prefilledEmail,
  returnUrl,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const registerFormStart = useRef(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthConsentReturnUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(
      signUpFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: prefilledEmail ?? "",
      name: "",
      password: "",
      termsAccepted: false,
      marketingOptIn: false,
    },
  });

  // when user first sees the register page
  useEffect(() => {
    fireGTMEvent.viewRegisterArea();
  }, []);

  // when user starts typing in the form
  useEffect(() => {
    if (registerFormStart.current) return;
    if (form.formState.isDirty) {
      registerFormStart.current = true;
      fireGTMEvent.registerFormStart();
    }
  }, [form.formState.isDirty]);

  const handleSubmit = async (values: SignUpFormSchemaType) => {
    track("Sign Up", { provider: "credential" });

    const result = await signUpEmail(
      {
        email: values.email,
        name: values.name,
        password: values.password,
        termsAccepted: values.termsAccepted,
        marketingOptIn: values.marketingOptIn,
      },
      effectiveReturnUrl,
    );

    if (result.ok) {
      if (result.data.redirect && result.data.redirectUrl) {
        window.location.href = result.data.redirectUrl;
        return;
      }

      await waitForAuthSession({
        context: "signup",
        getSession: createAuthSessionGetter(() => authClient.getSession()),
        logWarning: (message) => {
          Sentry.captureMessage(message, { level: "warning" });
        },
      });

      fireGTMEvent.signUp("credential");
      toast.success(t("success"));
      router.replace(normalizeAuthReturnUrl(effectiveReturnUrl));
    } else {
      switch (result.error.code) {
        case AuthErrorCode.EMAIL_DOMAIN_NOT_ALLOWED:
          toast.error(t("Errors.emailDomainNotAllowed"));
          break;
        case AuthErrorCode.TERMS_NOT_ACCEPTED:
          toast.error(t("Errors.termsNotAccepted"));
          break;
        default:
          toast.error(result.error.message ?? t("error"));
          break;
      }
    }
  };

  const termsAccepted = useWatch({
    control: form.control,
    name: "termsAccepted",
  });
  const formData: FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form"> =
    signUpFormData.map((item) =>
      item.name === "email" && prefilledEmail
        ? { ...item, disabled: true }
        : item,
    );

  const { isSubmitting } = form.formState;

  return (
    <AuthForm
      form={form}
      formData={formData}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-4">
        <SubmitButton
          isSubmitting={isSubmitting}
          label={t("submit")}
          className="w-full"
          disabled={!termsAccepted || isSubmitting}
        />
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <span className="text-muted-foreground text-sm">
            {t("Login.message")}
          </span>
          <Link
            href="/login"
            className="text-primary text-sm font-medium hover:underline"
          >
            {t("Login.link")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
