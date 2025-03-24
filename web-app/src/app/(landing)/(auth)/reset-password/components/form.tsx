"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
  const tSchema = useTranslations("Auth.Schema");
  const router = useRouter();

  const form = useForm<ResetPasswordFormSchemaType>({
    resolver: zodResolver(resetPasswordFormSchema, {
      errorMap: (error, ctx) => {
        const path = error.path.join(".");
        switch (path) {
          case "password":
            if (error.code === z.ZodIssueCode.invalid_string) {
              return { message: tSchema("Password.invalid") };
            }
            if (error.code === z.ZodIssueCode.too_small) {
              return { message: tSchema("Password.min") };
            }
            if (error.code === z.ZodIssueCode.too_big) {
              return { message: tSchema("Password.max") };
            }
            if (error.code === z.ZodIssueCode.custom) {
              const { lowercase, uppercase, number } = error.params ?? {};
              if (lowercase) return { message: tSchema("Password.lowercase") };
              if (uppercase) return { message: tSchema("Password.uppercase") };
              if (number) return { message: tSchema("Password.number") };
            }
          case "confirmPassword":
            if (error.code === z.ZodIssueCode.custom) {
              return { message: tSchema("ConfirmPassword.match") };
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
