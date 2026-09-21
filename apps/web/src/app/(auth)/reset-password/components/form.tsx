"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm } from "@/auth/components/form/auth-form";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { resetPasswordFormData } from "@/auth/reset-password/data";
import { resetPasswordWithToken } from "@/lib/actions/auth/action";
import {
  type ResetPasswordFormSchemaType,
  resetPasswordFormSchema,
} from "@/lib/schemas";

export default function ResetPasswordForm() {
  const t = useTranslations("Auth.Pages.ResetPassword.Form");
  const router = useRouter();

  const form = useForm<ResetPasswordFormSchemaType>({
    resolver: zodResolver(
      resetPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  async function handleSubmit(values: ResetPasswordFormSchemaType) {
    const resetPasswordResult = await resetPasswordWithToken(values);

    if (!resetPasswordResult.ok) {
      toast.error(t("error"));
      return;
    }

    toast.success(t("success"));
    router.push("/signin");
  }

  const { isSubmitting } = form.formState;

  return (
    <AuthForm
      form={form}
      formData={resetPasswordFormData}
      namespace="Auth.Pages.ResetPassword.Form"
      onSubmit={handleSubmit}
    >
      <SubmitButton isSubmitting={isSubmitting} label={t("submit")} />
    </AuthForm>
  );
}
