"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { AuthForm } from "@/auth/components/form/auth-form";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { signUpFormData } from "@/auth/signup/data";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { handleUtmConversion } from "@/lib/actions/auth/action";
import { AuthErrorCode } from "@/lib/actions/errors";
import { signUp } from "@/lib/auth/auth.client";
import { buildOAuthConsentReturnUrlFromSearchParams } from "@/lib/auth/auth.utils";
import { finishAuthInPlace } from "@/lib/auth/finish-auth.client";
import type { FormData } from "@/lib/form";
import { fireGTMEvent } from "@/lib/gtm-events";
import { type SignUpFormSchemaType, signUpFormSchema } from "@/lib/schemas";

interface SignUpFormProps {
  prefilledEmail?: string | undefined;
  returnUrl?: string | undefined;
}

export default function SignUpForm({
  prefilledEmail,
  returnUrl,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const registerFormStart = useRef(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("signup");
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthConsentReturnUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(
      signUpFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: prefilledEmail ?? "",
      name: "",
      password: "",
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
    track("Sign Up", { provider: "credential" });

    await runWithCaptcha(async (fetchOptions) => {
      const result = await signUp.email({
        fetchOptions,
        email: values.email,
        name: values.name,
        password: values.password,
        termsAccepted: values.termsAccepted,
        marketingOptIn: values.marketingOptIn,
      });

      if (result.error) {
        const errorCode =
          "code" in result.error ? result.error.code : undefined;

        switch (errorCode) {
          case AuthErrorCode.EMAIL_DOMAIN_NOT_ALLOWED:
            toast.error(t("Errors.emailDomainNotAllowed"));
            break;
          case AuthErrorCode.TERMS_NOT_ACCEPTED:
            toast.error(t("Errors.termsNotAccepted"));
            break;
          default:
            toast.error(
              getErrorMessage(result.error, result.error.message ?? t("error")),
            );
            break;
        }
        return;
      }

      // Record UTM attribution for every successful signup, including the
      // OAuth consent flow that finishAuthInPlace redirects to below.
      await handleUtmConversion();

      // No `callbackURL`: Better Auth would hard-redirect and every line
      // here would be racing the unload, which is how the credential
      // `sign_up` event went missing. See apps/web/TRACKING.md. It also
      // feeds the verification email's post-verify destination, so Core
      // anchors that to the web app (lib/verification-email-callback.ts)
      // rather than trusting whatever the client sent.
      setIsLeaving(true);
      await finishAuthInPlace({
        eventType: "signUp",
        provider: "credential",
        returnUrl: effectiveReturnUrl,
      });
    });
  };

  const termsAccepted = useWatch({
    control: form.control,
    name: "termsAccepted",
  });
  const formData: FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form"> =
    signUpFormData.map((item) =>
      item.name === "email" && prefilledEmail
        ? { ...item, disabled: true }
        : item,
    );

  const { isSubmitting } = form.formState;
  const isPending = isSubmitting || isLeaving;

  return (
    <AuthForm
      form={form}
      formData={formData}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-4">
        {captcha}
        <SubmitButton
          isSubmitting={isPending}
          spinnerPosition="start"
          label={t("submit")}
          className="w-full"
          disabled={!termsAccepted}
        />
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <span className="text-muted-foreground text-sm">
            {t("Login.message")}
          </span>
          <Link
            href="/signin"
            className="text-primary text-sm font-medium hover:underline"
          >
            {t("Login.link")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
