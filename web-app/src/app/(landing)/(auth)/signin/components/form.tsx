"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BaseForm } from "@/app/(landing)/(auth)/components/base-form";
import { FormFields } from "@/app/(landing)/(auth)/components/form-fields";
import { SubmitButton } from "@/app/(landing)/(auth)/components/submit-button";

import { signin } from "../actions";
import {
  signInFormData,
  signInFormSchema,
  SignInFormSchemaType,
} from "../data";

export default function SignInForm() {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(signInFormSchema(t)),
  });

  const onSubmit = async (values: SignInFormSchemaType) => {
    const result = await signin(values);

    if (result.success) {
      toast.success(t("success"));
      router.push("/dashboard");
    } else {
      toast.error(t("error"));
    }
  };

  return (
    <BaseForm form={form} onSubmit={onSubmit}>
      <FormFields
        form={form}
        formData={signInFormData}
        namespace="Auth.Pages.SignIn.Form"
      />
      <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
        <SubmitButton
          form={form}
          label={t("submit")}
          className="w-full sm:w-auto"
        />
        <div className="text-sm">
          <span className="text-muted-foreground">
            {t("ForgotPassword.text")}{" "}
          </span>
          <Link
            href="/forgot-password"
            className="text-primary font-medium hover:underline"
          >
            {t("ForgotPassword.link")}
          </Link>
        </div>
      </div>
    </BaseForm>
  );
}
