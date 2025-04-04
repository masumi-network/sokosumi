"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/landing/(auth)/components/form";
import { resetPassword } from "@/landing/(auth)/reset-password/actions";
import {
  resetPasswordFormData,
  resetPasswordFormSchema,
  type ResetPasswordFormSchemaType,
} from "@/landing/(auth)/reset-password/data";

interface ResetPasswordFormProps {
  token: string;
}

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations("Landing.Auth.Pages.ResetPassword.Form");
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

  async function onSubmit(values: ResetPasswordFormSchemaType) {
    const { success } = await resetPassword(values);
    if (success) {
      toast.success(t("success"));
      router.push("/signin");
    } else {
      toast.error(t("error"));
    }
  }

  return (
    <AuthForm
      form={form}
      formData={resetPasswordFormData}
      namespace="Landing.Auth.Pages.ResetPassword.Form"
      onSubmit={onSubmit}
    >
      <SubmitButton form={form} label={t("submit")} />
    </AuthForm>
  );
}
