"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/app/(landing)/(auth)/components/form";
import { signup } from "@/app/(landing)/(auth)/signup/actions";
import {
  signUpFormData,
  signUpFormSchema,
  SignUpFormSchemaType,
} from "@/app/(landing)/(auth)/signup/data";
import { LandingRoute } from "@/types/routes";

export default function SignUpForm() {
  const t = useTranslations("Auth.Pages.SignUp.Form");

  const router = useRouter();
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(signUpFormSchema(useTranslations("Auth.Schema"))),
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
      router.push(LandingRoute.SignIn);
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
