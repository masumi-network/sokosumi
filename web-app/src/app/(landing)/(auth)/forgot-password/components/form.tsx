"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/app/(landing)/(auth)/components/form";

import { forgotPassword } from "../actions";
import {
  forgotPasswordFormData,
  forgotPasswordFormSchema,
  type ForgotPasswordFormSchemaType,
} from "../data";

interface ForgotPasswordFormProps {
  initialEmail?: string;
}

export default function ForgotPasswordForm({
  initialEmail,
}: ForgotPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
  const router = useRouter();

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(forgotPasswordFormSchema(t)),
    defaultValues: {
      email: initialEmail || "",
    },
  });

  async function onSubmit(values: ForgotPasswordFormSchemaType) {
    const result = await forgotPassword(values);

    if (result.success) {
      toast.success(t("success"));
      router.push("/signin");
    } else {
      toast.error(t("error"));
    }
  }

  return (
    <AuthForm
      form={form}
      formData={forgotPasswordFormData}
      namespace="Auth.Pages.ForgotPassword.Form"
      onSubmit={onSubmit}
    >
      <SubmitButton form={form} label={t("reset_password")} />
    </AuthForm>
  );
}
