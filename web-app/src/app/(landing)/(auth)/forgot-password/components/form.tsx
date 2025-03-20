"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BaseForm } from "@/app/(landing)/(auth)/components/base-form";
import { FormFields } from "@/app/(landing)/(auth)/components/form-fields";
import { SubmitButton } from "@/app/(landing)/(auth)/components/submit-button";

import { forgotPassword } from "../actions";
import {
  forgotPasswordFormData,
  forgotPasswordFormSchema,
  type ForgotPasswordFormSchemaType,
} from "../data";

export default function ForgotPasswordForm() {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
  const router = useRouter();

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(forgotPasswordFormSchema(t)),
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
    <BaseForm form={form} onSubmit={onSubmit}>
      <FormFields
        form={form}
        formData={forgotPasswordFormData}
        namespace="Auth.Pages.ForgotPassword.Form"
      />
      <SubmitButton form={form} label={t("reset_password")} />
    </BaseForm>
  );
}
