"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  BaseForm,
  FormFields,
  SubmitButton,
} from "@/app/(landing)/(auth)/components/form";

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
    resolver: zodResolver(resetPasswordFormSchema(t)),
    defaultValues: {
      token: token,
    },
  });

  async function onSubmit(values: ResetPasswordFormSchemaType) {
    const result = await resetPassword(values);

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
        formData={resetPasswordFormData}
        namespace="Auth.Pages.ResetPassword.Form"
      />
      <SubmitButton form={form} label={t("submit")} />
    </BaseForm>
  );
}
