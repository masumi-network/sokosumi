"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
          <div className="flex items-center gap-2">
            <Checkbox id="rememberMe" />
            <Label htmlFor="rememberMe" className="text-sm">
              {t("rememberMe")}
            </Label>
          </div>
          <Link
            href={`/forgot-password${form.watch("email") ? `?email=${encodeURIComponent(form.watch("email"))}` : ""}`}
            className="text-muted-foreground text-sm hover:underline"
          >
            {t("forgotPassword")}
          </Link>
        </div>
        <SubmitButton form={form} label={t("submit")} className="w-full" />
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <span className="text-muted-foreground text-sm">
            {t("Register.message")}
          </span>
          <Link
            href="/register"
            className="text-primary text-sm font-medium hover:underline"
          >
            {t("Register.link")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
