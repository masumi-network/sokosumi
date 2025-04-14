"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/landing/(auth)/components/form";
import {
  signUpFormData,
  signUpFormSchema,
  SignUpFormSchemaType,
} from "@/landing/(auth)/signup/data";
import { authClient } from "@/lib/auth/auth.client";

export default function SignUpForm() {
  const t = useTranslations("Landing.Auth.Pages.SignUp.Form");

  const router = useRouter();
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(
      signUpFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: "",
      name: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (values: SignUpFormSchemaType) => {
    await authClient.signUp.email(
      {
        email: values.email,
        name: values.name,
        password: values.password,
        callbackURL: "/app",
      },
      {
        onError: (ctx) => {
          switch (ctx.error.code) {
            case "USER_ALREADY_EXISTS":
              toast.error(t("Errors.Submit.userExists"));
              break;
            default:
              toast.error(t("error"));
              break;
          }
        },
        onSuccess: () => {
          toast.success(t("success"));
          router.push("/signin");
        },
      },
    );
  };

  return (
    <AuthForm
      form={form}
      formData={signUpFormData}
      namespace="Landing.Auth.Pages.SignUp.Form"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
        <SubmitButton form={form} label={t("submit")} />
      </div>
    </AuthForm>
  );
}
