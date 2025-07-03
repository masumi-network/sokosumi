"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import { forgotPasswordFormData } from "@/auth/forgot-password/data";
import { useAsyncRouter } from "@/hooks/use-async-router";
import { forgetPassword } from "@/lib/auth/auth.client";
import {
  forgotPasswordFormSchema,
  ForgotPasswordFormSchemaType,
} from "@/lib/schemas";

interface ForgotPasswordFormProps {
  initialEmail?: string;
}

export default function ForgotPasswordForm({
  initialEmail,
}: ForgotPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
  const router = useAsyncRouter();

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(
      forgotPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: initialEmail ?? "",
    },
  });

  async function handleSubmit(values: ForgotPasswordFormSchemaType) {
    const forgetPasswordResult = await forgetPassword({
      email: values.email,
      redirectTo: "/reset-password",
    });

    if (forgetPasswordResult.error) {
      toast.error(t("error"));
      return;
    }

    toast.success(t("success"));
    await router.push("/login");
  }

  return (
    <AuthForm
      form={form}
      formData={forgotPasswordFormData}
      namespace="Auth.Pages.ForgotPassword.Form"
      onSubmit={handleSubmit}
    >
      <SubmitButton form={form} label={t("reset_password")} />
    </AuthForm>
  );
}
