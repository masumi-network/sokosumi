"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/app/(landing)/(auth)/components/form";

import { resetPassword } from "../actions";
import {
  resetPasswordFormData,
  resetPasswordFormSchema,
  type ResetPasswordFormSchemaType,
} from "../data";

interface ResetPasswordFormProps {
  token: string;
}

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ResetPassword.Form");
  const router = useRouter();

  const form = useForm<ResetPasswordFormSchemaType>({
    resolver: zodResolver(resetPasswordFormSchema, {
      errorMap: (error, ctx) => {
        const path = error.path.join(".");
        switch (path) {
          case "password":
            if (error.code === "too_small") {
              return { message: t("Errors.Password.min") };
            }
            if (error.code === "too_big") {
              return { message: t("Errors.Password.max") };
            }
            if (error.code === "invalid_string") {
              return { message: t("Errors.Password.regex") };
            }
            return { message: ctx.defaultError };
          case "confirmPassword":
            if (error.code === "custom") {
              return { message: t("Errors.ConfirmPassword.match") };
            }
        }
        return { message: ctx.defaultError };
      },
    }),
    defaultValues: {
      password: "",
      confirmPassword: "",
      token: token,
    },
  });

  async function onSubmit(values: ResetPasswordFormSchemaType) {
    try {
      await resetPassword(values);
      toast.success(t("success"));
      router.push("/signin");
    } catch {
      toast.error(t("error"));
    }
  }

  return (
    <AuthForm
      form={form}
      formData={resetPasswordFormData}
      namespace="Auth.Pages.ResetPassword.Form"
      onSubmit={onSubmit}
    >
      <SubmitButton form={form} label={t("submit")} />
    </AuthForm>
  );
}
