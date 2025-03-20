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

import { signup } from "../actions";
import {
  signUpFormData,
  signUpFormSchema,
  SignUpFormSchemaType,
} from "../data";

export default function SignUpForm() {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const router = useRouter();
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(signUpFormSchema(t)),
  });

  const onSubmit = async (values: SignUpFormSchemaType) => {
    const result = await signup(values);

    if (result.success) {
      toast.success(t("success"));
      router.push("/signin");
    } else {
      toast.error(t("error"));
    }
  };

  return (
    <BaseForm form={form} onSubmit={onSubmit}>
      <FormFields
        form={form}
        formData={signUpFormData}
        namespace="Auth.Pages.SignUp.Form"
      />
      <SubmitButton form={form} label={t("submit")} />
    </BaseForm>
  );
}
