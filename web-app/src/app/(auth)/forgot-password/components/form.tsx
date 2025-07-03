"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import {
  forgotPasswordFormData,
  forgotPasswordFormSchema,
  ForgotPasswordFormSchemaType,
} from "@/auth/forgot-password/data";
import { authClient } from "@/lib/auth/auth.client";

interface ForgotPasswordFormProps {
  initialEmail?: string;
}

export default function ForgotPasswordForm({
  initialEmail,
}: ForgotPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
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
    await authClient.forgetPassword(
      {
        email: values.email,
        redirectTo: "/reset-password",
      },
      {
        onError: () => {
          toast.error(t("error"));
        },
        onSuccess: () => {
          toast.success(t("success"));
          router.push("/login");
        },
      },
    );
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
