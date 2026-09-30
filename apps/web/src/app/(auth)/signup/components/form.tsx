"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { joinFirstAndLastName } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { signUpFormData, signUpNameFormData } from "@/auth/signup/data";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { handleUtmConversion } from "@/lib/actions/auth/action";
import { AuthErrorCode } from "@/lib/actions/errors/error-codes/auth";
import { signUp } from "@/lib/auth/auth.client";
import {
  buildOAuthResumeUrlFromSearchParams,
  isRejectedOAuthRequestError,
} from "@/lib/auth/auth.utils";
import { finishAuthInPlace } from "@/lib/auth/finish-auth.client";
import {
  type SignUpFormSchemaType,
  signUpFormSchema,
} from "@/lib/schemas/auth";

interface SignUpFormProps {
  /** Confirmed on the step before this one. */
  email: string;
  returnUrl?: string | undefined;
  onFormStart: () => void;
  onPendingChange: (pending: boolean) => void;
}

/** Second sign-up step: name and password for a known email. */
export default function SignUpForm({
  email,
  returnUrl,
  onFormStart,
  onPendingChange,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const [isLeaving, setIsLeaving] = useState(false);
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("signup");
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(
      signUpFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      firstName: "",
      lastName: "",
      password: "",
      marketingOptIn: false,
    },
  });

  // The step replaced the one the user was typing in, so focus follows.
  useMountEffect(() => {
    form.setFocus("firstName");
  });

  const handleSubmit = async (values: SignUpFormSchemaType) => {
    track("Sign Up", { provider: "credential" });

    onPendingChange(true);
    let willLeave = false;
    try {
      await runWithCaptcha(async (fetchOptions) => {
        const result = await signUp.email({
          fetchOptions,
          email,
          firstName: values.firstName,
          lastName: values.lastName,
          // Core derives the display name from the two parts; the client type
          // still asks for one.
          name: joinFirstAndLastName(values.firstName, values.lastName),
          password: values.password,
          // Creating the account is the acceptance; the page says so.
          termsAccepted: true,
          marketingOptIn: values.marketingOptIn,
        });

        if (result.error) {
          if (isRejectedOAuthRequestError(result.error)) {
            toast.error(oauthT("errorDescription"));
            return;
          }

          const errorCode =
            "code" in result.error ? result.error.code : undefined;

          switch (errorCode) {
            case AuthErrorCode.EMAIL_DOMAIN_NOT_ALLOWED:
              toast.error(t("Errors.emailDomainNotAllowed"));
              break;
            default:
              toast.error(
                getErrorMessage(
                  result.error,
                  result.error.message ?? t("error"),
                ),
              );
              break;
          }
          return;
        }

        // No `callbackURL`: Better Auth would hard-redirect and every line
        // here would be racing the unload, which is how the credential
        // `sign_up` event went missing. See apps/web/TRACKING.md. It also
        // feeds the verification email's post-verify destination, so Core
        // anchors that to the web app (lib/verification-email-callback.ts)
        // rather than trusting whatever the client sent.
        willLeave = true;
        setIsLeaving(true);
        await finishAuthInPlace({
          eventType: "signUp",
          provider: "credential",
          returnUrl: effectiveReturnUrl,
          result: result.data,
          // Record UTM attribution for every successful signup, including one
          // that carries an OAuth request.
          beforeLeaving: handleUtmConversion,
        });
      });
    } finally {
      // Keep the flow locked after success until the page navigates away.
      if (!willLeave) onPendingChange(false);
    }
  };

  const { isSubmitting } = form.formState;
  const isPending = isSubmitting || isLeaving;

  return (
    <BaseForm form={form} onSubmit={handleSubmit} onChange={onFormStart}>
      {/* Password managers pair the new password with this address. */}
      <input
        type="email"
        autoComplete="username"
        value={email}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <div className="grid grid-cols-2 items-start gap-3">
        <FormFields
          form={form}
          formData={signUpNameFormData}
          namespace="Auth.Pages.SignUp.Form"
        />
      </div>
      <FormFields
        form={form}
        formData={signUpFormData}
        namespace="Auth.Pages.SignUp.Form"
      />
      <div className="flex flex-col gap-4">
        {captcha}
        <SubmitButton
          isSubmitting={isPending}
          spinnerPosition="start"
          label={t("submit")}
          className="w-full"
        />
      </div>
    </BaseForm>
  );
}
