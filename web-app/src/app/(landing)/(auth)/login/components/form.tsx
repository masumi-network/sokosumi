"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/landing/(auth)/components/form";
import {
  signInFormData,
  signInFormSchema,
  SignInFormSchemaType,
} from "@/landing/(auth)/login/data";
import { authClient } from "@/lib/auth/auth.client";

export default function SignInForm() {
  const t = useTranslations("Landing.Auth.Pages.SignIn.Form");

  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(
      signInFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: "",
      currentPassword: "",
    },
  });

  const onSubmit = async (values: SignInFormSchemaType) => {
    await authClient.signIn.email(
      {
        email: values.email,
        password: values.currentPassword,
      },
      {
        onError: (ctx) => {
          switch (ctx.error.code) {
            case "EMAIL_NOT_VERIFIED":
              toast.error(t("Errors.Submit.verifyEmail"));
              break;
            default:
              toast.error(t("error"));
              break;
          }
        },
        onSuccess: () => {
          toast.success(t("success"));
          router.push("/app");
        },
      },
    );
  };

  return (
    <AuthForm
      form={form}
      formData={signInFormData}
      namespace="Landing.Auth.Pages.SignIn.Form"
      onSubmit={onSubmit}
    >
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
            href={`/forgot-password${form.watch("email") ? `?email=${encodeURIComponent(form.watch("email"))}` : ""}`}
            className="text-primary font-medium hover:underline"
          >
            {t("ForgotPassword.link")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
