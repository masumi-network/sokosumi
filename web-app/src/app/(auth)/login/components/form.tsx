"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import { signInFormData } from "@/auth/login/data";
import { signIn } from "@/lib/auth/auth.client";
import { signInFormSchema, SignInFormSchemaType } from "@/lib/schemas";

interface SignInFormProps {
  returnUrl?: string | undefined;
  prefilledEmail?: string | undefined;
}

export default function SignInForm({
  returnUrl,
  prefilledEmail,
}: SignInFormProps) {
  const t = useTranslations("Auth.Pages.SignIn.Form");

  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(
      signInFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: prefilledEmail ?? "",
      currentPassword: "",
      rememberMe: false,
    },
  });

  const handleSubmit = async (values: SignInFormSchemaType) => {
    const singInResult = await signIn.email({
      email: values.email,
      password: values.currentPassword,
      rememberMe: values.rememberMe,
    });

    if (singInResult.error) {
      switch (singInResult.error.code) {
        case "EMAIL_NOT_VERIFIED":
          toast.error(t("Errors.verifyEmail"));
          break;
        case "TERMS_NOT_ACCEPTED":
          toast.error(t("Errors.termsNotAccepted"));
          break;
        default:
          toast.error(t("error"));
          break;
      }
      return;
    }

    toast.success(t("success"));
    // Redirect to the original URL if provided, otherwise go to /agents
    // Validate returnUrl to prevent open redirect attacks
    let redirectUrl = "/agents";
    if (returnUrl) {
      try {
        // Only allow relative URLs or URLs from the same origin
        const url = new URL(returnUrl, window.location.origin);
        if (url.origin === window.location.origin) {
          redirectUrl = returnUrl;
        }
      } catch {
        // Invalid URL, fallback to /agents
      }
    }
    router.push(redirectUrl);
  };

  const email = form.watch("email");
  const forgotPasswordUrl = useMemo(
    () =>
      `/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`,
    [email],
  );

  return (
    <AuthForm
      form={form}
      formData={signInFormData}
      namespace="Auth.Pages.SignIn.Form"
      onSubmit={handleSubmit}
      submitEventName="SignIn"
    >
      <div className="flex flex-col gap-4">
        <SubmitButton form={form} label={t("submit")} className="w-full" />
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <div className="flex flex-row items-center gap-2">
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
          <Link
            href={forgotPasswordUrl}
            className="text-muted-foreground text-sm hover:underline"
          >
            {t("forgotPassword")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
