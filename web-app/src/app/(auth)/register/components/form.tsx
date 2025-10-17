"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import { signUpFormData } from "@/auth/register/data";
import { AuthErrorCode, signUpEmail } from "@/lib/actions";
import { FormData } from "@/lib/form";
import { fireGTMEvent } from "@/lib/gtm-events";
import { signUpFormSchema, SignUpFormSchemaType } from "@/lib/schemas";

interface SignUpFormProps {
  prefilledEmail?: string | undefined;
  invitationId?: string | undefined;
}

export default function SignUpForm({ prefilledEmail }: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const registerFormStart = useRef(false);

  const router = useRouter();
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(
      signUpFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: prefilledEmail ?? "",
      name: "",
      password: "",
      confirmPassword: "",
      termsAccepted: false,
      marketingOptIn: false,
    },
  });

  // when user first sees the register page
  useEffect(() => {
    fireGTMEvent.viewRegisterArea();
  }, []);

  // when user starts typing in the form
  useEffect(() => {
    if (registerFormStart.current) return;
    if (form.formState.isDirty) {
      registerFormStart.current = true;
      fireGTMEvent.registerFormStart();
    }
  }, [form.formState.isDirty]);

  const handleSubmit = async (values: SignUpFormSchemaType) => {
    track("signUp");

    const result = await signUpEmail({
      email: values.email,
      name: values.name,
      password: values.password,
      confirmPassword: values.confirmPassword,
      termsAccepted: values.termsAccepted,
      marketingOptIn: values.marketingOptIn,
    });

    if (result.ok) {
      fireGTMEvent.signUp();
      toast.success(t("success"));
      router.push("/login");
    } else {
      switch (result.error.code) {
        case AuthErrorCode.EMAIL_DOMAIN_NOT_ALLOWED:
          toast.error(t("Errors.emailDomainNotAllowed"));
          break;
        case AuthErrorCode.TERMS_NOT_ACCEPTED:
          toast.error(t("Errors.termsNotAccepted"));
          break;
        default:
          toast.error(result.error.message ?? t("error"));
          break;
      }
    }
  };

  const termsAccepted = form.watch("termsAccepted");
  const formData: FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form"> =
    signUpFormData.map((item) =>
      item.name === "email" && prefilledEmail
        ? { ...item, disabled: true }
        : item,
    );

  return (
    <AuthForm
      form={form}
      formData={formData}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-4">
        <SubmitButton
          form={form}
          label={t("submit")}
          className="w-full"
          disabled={!termsAccepted}
        />
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
