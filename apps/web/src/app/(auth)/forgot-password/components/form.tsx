"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { SubmitButton } from "@/auth/components/form/submit-button";
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
import type { FormData } from "@/lib/form";
import { type EmailFormSchemaType, emailFormSchema } from "@/lib/schemas/auth";

const formData: FormData<
  EmailFormSchemaType,
  "Auth.Pages.ForgotPassword.Form"
> = [
  {
    name: "email",
    labelKey: "Fields.Email.label",
    type: "email",
    autoComplete: "email",
  },
];

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

  const form = useForm<EmailFormSchemaType>({
    resolver: zodResolver(
      emailFormSchema(useTranslations("Library.Auth.Schema")),
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

  async function handleSubmit(values: EmailFormSchemaType) {
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
      {/* A new link replaces the dead one, so the notice goes with it. */}
      {linkExpired && !isEmailSent ? (
        <Alert>
          <AlertDescription>{t("linkExpired")}</AlertDescription>
        </Alert>
      ) : null}
      <BaseForm form={form} onSubmit={handleSubmit}>
        <FormFields
          form={form}
          formData={formData}
          namespace="Auth.Pages.ForgotPassword.Form"
        />
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
      </BaseForm>
    </>
  );
}
