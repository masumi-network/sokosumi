"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AuthForm } from "@/auth/components/form/auth-form";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { forgotPasswordFormData } from "@/auth/forgot-password/data";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { requestPasswordReset } from "@/lib/auth/auth.client";
import {
  buildAuthPageUrl,
  getAbsoluteAuthRedirectUrl,
  readAuthPageContext,
} from "@/lib/auth/auth.utils";
import { takeAuthEmailHint } from "@/lib/auth/auth-email-hint";
import {
  type ForgotPasswordFormSchemaType,
  forgotPasswordFormSchema,
} from "@/lib/schemas/auth";

interface ForgotPasswordFormProps {
  /** The person followed a reset link that expired or was already used. */
  linkExpired?: boolean;
}

export default function ForgotPasswordForm({
  linkExpired = false,
}: ForgotPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("forgot-password");
  const searchParams = useSearchParams();
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(
      forgotPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: "",
    },
  });

  // Sign-in hands over the address it was given, outside the URL.
  useMountEffect(() => {
    const emailHint = takeAuthEmailHint();
    if (emailHint) {
      form.setValue("email", emailHint);
    }
  });

  async function handleSubmit(values: ForgotPasswordFormSchemaType) {
    setIsEmailSent(false);
    setError(null);
    try {
      await runWithCaptcha(async (fetchOptions) => {
        const result = await requestPasswordReset({
          fetchOptions,
          email: values.email,
          // The emailed link returns to the sign-in this request started from.
          redirectTo: getAbsoluteAuthRedirectUrl(
            buildAuthPageUrl(
              "/reset-password/exchange",
              readAuthPageContext(searchParams),
            ),
          ),
        });

        if (!result.error) {
          setIsEmailSent(true);
          return;
        }

        setError(
          result.error.status === 429
            ? t("Errors.rateLimited")
            : getErrorMessage(result.error, t("Errors.generic")),
        );
      });
    } catch {
      setError(t("Errors.generic"));
    }
  }

  const { isSubmitting } = form.formState;

  return (
    <>
      {linkExpired ? (
        <Alert>
          <AlertDescription>{t("linkExpired")}</AlertDescription>
        </Alert>
      ) : null}
      <AuthForm
        form={form}
        formData={forgotPasswordFormData}
        namespace="Auth.Pages.ForgotPassword.Form"
        onSubmit={handleSubmit}
      >
        <p role="status" className="text-sm text-muted-foreground empty:-mt-3">
          {isEmailSent ? t("success") : null}
        </p>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {captcha}
        <SubmitButton isSubmitting={isSubmitting} label={t("reset_password")} />
      </AuthForm>
    </>
  );
}
