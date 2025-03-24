"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/app/(landing)/(auth)/components/form";

import { signup } from "../actions";
import {
  signUpFormData,
  signUpFormSchema,
  SignUpFormSchemaType,
} from "../data";

export default function SignUpForm() {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const tSchema = useTranslations("Auth.Schema");

  const router = useRouter();
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(signUpFormSchema, {
      errorMap: (error, ctx) => {
        const path = error.path.join(".");
        switch (path) {
          case "email":
            return { message: tSchema("Email.invalid") };
          case "name":
            if (error.code === "too_big") {
              return { message: tSchema("Name.max") };
            }
            if (error.code === "too_small") {
              return { message: tSchema("Name.min") };
            }
            if (error.code === "invalid_string") {
              return { message: tSchema("Name.invalid") };
            }
          case "password":
            if (error.code === "invalid_string") {
              return { message: tSchema("Password.invalid") };
            }
            if (error.code === "too_small") {
              return { message: tSchema("Password.min") };
            }
            if (error.code === "too_big") {
              return { message: tSchema("Password.max") };
            }
            if (error.code === "custom") {
              const { lowercase, uppercase, number } = error.params ?? {};
              if (lowercase) return { message: tSchema("Password.lowercase") };
              if (uppercase) return { message: tSchema("Password.uppercase") };
              if (number) return { message: tSchema("Password.number") };
            }
          case "confirmPassword":
            if (error.code === "custom") {
              return { message: tSchema("ConfirmPassword.match") };
            }
        }
        return { message: ctx.defaultError };
      },
    }),
    defaultValues: {
      email: "",
      name: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (values: SignUpFormSchemaType) => {
    try {
      await signup(values);
      toast.success(t("success"));
      router.push("/signin");
    } catch {
      toast.error(t("error"));
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
