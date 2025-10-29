"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import { resetPasswordFormData } from "@/auth/reset-password/data";
import { resetPassword } from "@/lib/auth/auth.client";
import {
  resetPasswordFormSchema,
  ResetPasswordFormSchemaType,
} from "@/lib/schemas";

interface ResetPasswordFormProps {
  token: string;
}

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ResetPassword.Form");
  const router = useRouter();

  const form = useForm<ResetPasswordFormSchemaType>({
    resolver: zodResolver(
      resetPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      password: "",
      confirmPassword: "",
      token: token,
    },
  });

  async function handleSubmit(values: ResetPasswordFormSchemaType) {
    const resetPasswordResult = await resetPassword({
      newPassword: values.password,
      token: values.token,
    });

    if (resetPasswordResult.error) {
      toast.error(t("error"));
      return;
    }

    toast.success(t("success"));
    router.push("/login");
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
