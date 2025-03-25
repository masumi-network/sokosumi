"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/app/(landing)/(auth)/components/form";
import { createErrorMap } from "@/lib/form";

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
    resolver: zodResolver(signUpFormSchema, {
      errorMap: createErrorMap({ t: useTranslations("Auth.Schema") }),
    }),
    defaultValues: {
      email: "",
      name: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (values: SignUpFormSchemaType) => {
    const { success, error } = await signup(values);
    if (success) {
      toast.success(t("success"));
      router.push("/signin");
    } else {
      if (error === "userExists") {
        toast.error(t("Errors.Submit.userExists"));
      } else {
        toast.error(t("error"));
      }
    }
  };

  return (
    <AuthForm
      form={form}
      formData={signUpFormData}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
        <SubmitButton form={form} label={t("submit")} />
      </div>
    </AuthForm>
  );
}
