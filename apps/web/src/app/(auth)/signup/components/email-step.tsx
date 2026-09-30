"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { signUpEmailFormData } from "@/auth/signup/data";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";
import { isRejectedOAuthRequestError } from "@/lib/auth/auth.utils";
import {
  type SignUpEmailFormSchemaType,
  signUpEmailFormSchema,
} from "@/lib/schemas/auth";

import { useSignInHref } from "./sign-in-link";

interface SignUpEmailStepProps {
  defaultEmail: string;
  /** An invitation fixes the address; the user can only confirm it. */
  emailLocked: boolean;
  /** Set when the user came back here from the next step. */
  autoFocus: boolean;
  onFormStart: () => void;
  onContinue: (email: string) => void;
}

/**
 * First sign-up step. It asks Core whether the address already has an
 * account, so that person is pointed at sign-in instead of being asked for a
 * name and a password first.
 */
export function SignUpEmailStep({
  defaultEmail,
  emailLocked,
  autoFocus,
  onFormStart,
  onContinue,
}: SignUpEmailStepProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const signInHref = useSignInHref();
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("signup");
  const [accountExists, setAccountExists] = useState(false);
  const form = useForm<SignUpEmailFormSchemaType>({
    resolver: zodResolver(
      signUpEmailFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: { email: defaultEmail },
  });

  useMountEffect(() => {
    if (autoFocus) {
      form.setFocus("email");
    }
  });

  async function handleSubmit({ email }: SignUpEmailFormSchemaType) {
    await runWithCaptcha(async (fetchOptions) => {
      const result = await authClient.$fetch<{ exists: boolean }>(
        "/sign-up/email-status",
        { method: "POST", body: { email }, headers: fetchOptions.headers },
      );

      if (result.error) {
        // The auth client adds the page's OAuth request to every call, this
        // one included, and Core refuses the call when that request is stale.
        if (isRejectedOAuthRequestError(result.error)) {
          toast.error(oauthT("errorDescription"));
          return;
        }

        // Core puts the captcha's error code on the body; the client types
        // only the transport fields.
        const error: { code?: string; message?: string } = result.error;
        toast.error(getErrorMessage(error, error.message ?? t("error")));
        return;
      }

      if (result.data.exists) {
        setAccountExists(true);
        // The button this came from is replaced below, so focus moves to the
        // field the message belongs to.
        form.setError(
          "email",
          { type: "exists", message: t("Errors.emailExists") },
          { shouldFocus: true },
        );
        return;
      }

      onContinue(email);
    });
  }

  return (
    <BaseForm
      form={form}
      onSubmit={handleSubmit}
      onChange={() => {
        // The answer was about the address as it was.
        setAccountExists(false);
        onFormStart();
      }}
    >
      <FormFields
        form={form}
        formData={
          emailLocked
            ? signUpEmailFormData.map((item) => ({ ...item, disabled: true }))
            : signUpEmailFormData
        }
        namespace="Auth.Pages.SignUp.Form"
      />
      <div className="flex flex-col gap-4">
        {captcha}
        {accountExists ? (
          <Button asChild variant="primary" className="w-full">
            <Link href={signInHref}>{t("logInInstead")}</Link>
          </Button>
        ) : (
          <SubmitButton
            isSubmitting={form.formState.isSubmitting}
            spinnerPosition="start"
            label={t("continueWithEmail")}
            className="w-full"
          />
        )}
      </div>
    </BaseForm>
  );
}
