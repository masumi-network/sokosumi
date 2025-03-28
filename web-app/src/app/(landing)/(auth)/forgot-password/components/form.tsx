"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/landing/(auth)/components/form";
import { forgotPassword } from "@/landing/(auth)/forgot-password/actions";
import {
  forgotPasswordFormData,
  forgotPasswordFormSchema,
  ForgotPasswordFormSchemaType,
} from "@/landing/(auth)/forgot-password/data";
import { LandingRoute } from "@/types/routes";

interface ForgotPasswordFormProps {
  initialEmail?: string;
}

export default function ForgotPasswordForm({
  initialEmail,
}: ForgotPasswordFormProps) {
  const t = useTranslations("Landing.Auth.Pages.ForgotPassword.Form");
  const router = useRouter();

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(
      forgotPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: initialEmail ?? "",
    },
  });

  async function onSubmit(values: ForgotPasswordFormSchemaType) {
    const { success } = await forgotPassword(values);
    if (success) {
      toast.success(t("success"));
      router.push(LandingRoute.SignIn);
    } else {
      toast.error(t("error"));
    }
  }

  return (
    <AuthForm
      form={form}
      formData={forgotPasswordFormData}
      namespace="Landing.Auth.Pages.ForgotPassword.Form"
      onSubmit={onSubmit}
    >
      <SubmitButton form={form} label={t("reset_password")} />
    </AuthForm>
  );
}
