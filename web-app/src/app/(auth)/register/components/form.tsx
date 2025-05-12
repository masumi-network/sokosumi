"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import {
  signUpFormData,
  signUpFormSchema,
  SignUpFormSchemaType,
} from "@/auth/register/data";
import { authClient } from "@/lib/auth/auth.client";

export default function SignUpForm() {
  const t = useTranslations("Auth.Pages.SignUp.Form");

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
        onRequest: (ctx) => {
          console.log("ctx onRequest", ctx);
        },
        onError: (ctx) => {
          switch (ctx.error.code) {
            case "USER_ALREADY_EXISTS":
              toast.error(t("Errors.Submit.userExists"));
              break;
            case "EMAIL_DOMAIN_NOT_ALLOWED":
              toast.error(
                t("Errors.Submit.emailDomainNotAllowed", {
                  allowedEmailDomains: ctx.error.message,
                }),
              );
              break;
            default:
              toast.error(t("error"));
              break;
          }
        },
        onSuccess: () => {
          toast.success(t("success"));
          router.push("/login");
        },
      },
    );
  };

  return (
    <AuthForm
      form={form}
      formData={signUpFormData}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-4">
        <SubmitButton form={form} label={t("submit")} className="w-full" />
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <span className="text-muted-foreground text-sm">
            {t("Login.message")}
          </span>
          <Link
            href="/login"
            className="text-primary text-sm font-medium hover:underline"
          >
            {t("Login.link")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
