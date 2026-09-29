"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AuthForm } from "@/auth/components/form/auth-form";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { forgotPasswordFormData } from "@/auth/forgot-password/data";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { requestPasswordReset } from "@/lib/auth/auth.client";
import { getAbsoluteAuthRedirectUrl } from "@/lib/auth/auth.utils";
import {
  type ForgotPasswordFormSchemaType,
  forgotPasswordFormSchema,
} from "@/lib/schemas/auth";

interface ForgotPasswordFormProps {
  initialEmail?: string;
}

export default function ForgotPasswordForm({
  initialEmail,
}: ForgotPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
  const { widget: captcha, runWithCaptcha } = useAuthCaptcha("forgot-password");
  const [isEmailSent, setIsEmailSent] = useState(false);

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(
      forgotPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: initialEmail ?? "",
    },
  });

  async function handleSubmit(values: ForgotPasswordFormSchemaType) {
    setIsEmailSent(false);
    try {
      await runWithCaptcha(async (fetchOptions) => {
        const result = await requestPasswordReset({
          fetchOptions,
          email: values.email,
          redirectTo: getAbsoluteAuthRedirectUrl("/reset-password/exchange"),
        });

        if (!result.error) {
          setIsEmailSent(true);
        }
      });
    } catch {
      // Password reset request failures stay silent (SOK-1144).
    }
  }

  const { isSubmitting } = form.formState;

  return (
    <AuthForm
      form={form}
      formData={forgotPasswordFormData}
      namespace="Auth.Pages.ForgotPassword.Form"
      onSubmit={handleSubmit}
    >
      <p role="status" className="text-sm text-muted-foreground empty:-mt-3">
        {isEmailSent ? t("success") : null}
      </p>
      {captcha}
      <SubmitButton isSubmitting={isSubmitting} label={t("reset_password")} />
    </AuthForm>
  );
}
