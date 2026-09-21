"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { AuthForm } from "@/auth/components/form/auth-form";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { forgotPasswordFormData } from "@/auth/forgot-password/data";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { requestPasswordReset } from "@/lib/auth/auth.client";
import { getAbsoluteAuthRedirectUrl } from "@/lib/auth/auth.utils";
import {
  type ForgotPasswordFormSchemaType,
  forgotPasswordFormSchema,
} from "@/lib/schemas";

interface ForgotPasswordFormProps {
  initialEmail?: string;
}

export default function ForgotPasswordForm({
  initialEmail,
}: ForgotPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("forgot-password");
  const router = useRouter();

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(
      forgotPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: initialEmail ?? "",
    },
  });

  async function handleSubmit(values: ForgotPasswordFormSchemaType) {
    await runWithCaptcha(async (fetchOptions) => {
      const requestPasswordResetResult = await requestPasswordReset({
        fetchOptions,
        email: values.email,
        redirectTo: getAbsoluteAuthRedirectUrl("/reset-password/exchange"),
      });

      if (requestPasswordResetResult.error) {
        toast.error(
          getErrorMessage(requestPasswordResetResult.error, t("error")),
        );
        return;
      }

      toast.success(t("success"));
      router.push("/signin");
    });
  }

  const { isSubmitting } = form.formState;

  return (
    <AuthForm
      form={form}
      formData={forgotPasswordFormData}
      namespace="Auth.Pages.ForgotPassword.Form"
      onSubmit={handleSubmit}
    >
      {captcha}
      <SubmitButton isSubmitting={isSubmitting} label={t("reset_password")} />
    </AuthForm>
  );
}
