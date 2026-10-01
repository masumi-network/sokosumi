"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { joinFirstAndLastName } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { EmailCodeSwitch } from "@/auth/components/email-code-switch";
import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { SubmitButton } from "@/auth/components/form/submit-button";
import type { EmailCode } from "@/auth/components/use-email-code";
import {
  signUpMarketingFormData,
  signUpNameFormData,
  signUpPasswordFormData,
} from "@/auth/signup/data";
import {
  EMAIL_CODE_LENGTH,
  EmailCodeField,
  useDescribeEmailCodeError,
} from "@/components/auth/email-code-field";
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
import { signUpFormSchema } from "@/lib/schemas/auth";

interface SignUpFormProps {
  /** Confirmed on the step before this one. */
  email: string;
  returnUrl?: string | undefined;
  /** The code step 1 sent to `email`, if it went out. */
  emailCode: EmailCode;
  onFormStart: () => void;
  onPendingChange: (pending: boolean) => void;
}

/**
 * Second sign-up step. Step 1 has emailed a code, so this asks for the name
 * and that code, with one Register. A password is a deliberate switch, and
 * the step opens on it when no code went out.
 */
export default function SignUpForm({
  email,
  returnUrl,
  emailCode,
  onFormStart,
  onPendingChange,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const codeT = useTranslations("Components.EmailCodeForm");
  const schemaT = useTranslations("Library.Auth.Schema");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const describeCodeError = useDescribeEmailCodeError();
  const [isLeaving, setIsLeaving] = useState(false);
  const [prefersPassword, setPrefersPassword] = useState(false);
  const [refusedCode, setRefusedCode] = useState(0);
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

  const wasCodeSent = emailCode.sentTo === email;
  const isCodeStep = wasCodeSent && !prefersPassword;
  // Read by the resolver, which validates whichever way the step finishes.
  const isCodeStepRef = useRef(isCodeStep);
  isCodeStepRef.current = isCodeStep;

  const passwordStepSchema = signUpFormSchema(schemaT).safeExtend({
    code: z.string(),
  });
  const codeStepSchema = signUpFormSchema(schemaT).safeExtend({
    password: z.string(),
    code: z
      .string()
      .length(EMAIL_CODE_LENGTH, { message: codeT("incomplete") }),
  });
  const form = useForm<z.infer<typeof passwordStepSchema>>({
    resolver: (values, context, options) =>
      zodResolver(isCodeStepRef.current ? codeStepSchema : passwordStepSchema)(
        values,
        context,
        options,
      ),
    defaultValues: {
      firstName: "",
      lastName: "",
      password: "",
      code: "",
      marketingOptIn: false,
    },
  });

  // The step replaced the one the user was typing in, so focus follows.
  useMountEffect(() => {
    form.setFocus("firstName");
  });

  const handleCodeSubmit = async (
    values: z.infer<typeof passwordStepSchema>,
  ) => {
    track("Sign Up", { provider: "email-otp" });
    const error = await emailCode.signInWithCode(email, values.code, {
      firstName: values.firstName,
      lastName: values.lastName,
      // Unset is a no; Better Auth's own default would be yes.
      marketingOptIn: values.marketingOptIn ?? false,
      termsAccepted: true,
    });
    if (error) {
      form.setError("code", { message: describeCodeError(error) });
      setRefusedCode((count) => count + 1);
      return;
    }
    // The page is leaving; keep the step locked until it has.
    setIsLeaving(true);
    onPendingChange(true);
  };

  const handlePasswordSubmit = async (
    values: z.infer<typeof passwordStepSchema>,
  ) => {
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

  const switchTo = (method: "password" | "code") => {
    form.clearErrors(method === "code" ? "password" : "code");
    setPrefersPassword(method === "password");
  };

  const { isSubmitting } = form.formState;
  const isPending = isSubmitting || isLeaving;

  // A refused code sends focus back to its field. A submitting fieldset
  // cannot receive focus; wait until it is enabled again.
  useEffect(() => {
    if (refusedCode === 0 || isSubmitting) return;
    form.setFocus("code");
  }, [refusedCode, isSubmitting, form]);

  return (
    <BaseForm
      form={form}
      onSubmit={isCodeStep ? handleCodeSubmit : handlePasswordSubmit}
      onChange={onFormStart}
    >
      {/* Password managers pair the new password with this address. */}
      <input
        type="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
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
      {isCodeStep ? (
        <Controller
          control={form.control}
          name="code"
          render={({ field, fieldState }) => (
            <EmailCodeField
              inputRef={field.ref}
              value={field.value}
              onChange={field.onChange}
              onComplete={() => {
                // Only when Register would go through: a code typed before
                // the names waits for the button, with nothing new marked.
                if (
                  !isPending &&
                  codeStepSchema.safeParse(form.getValues()).success
                ) {
                  void form.handleSubmit(handleCodeSubmit)();
                }
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              sentAt={emailCode.sentAt}
              onResend={() => {
                void emailCode.sendCode(email);
              }}
              isResending={emailCode.isSending}
              disabled={isPending}
            />
          )}
        />
      ) : (
        <FormFields
          form={form}
          formData={signUpPasswordFormData}
          namespace="Auth.Pages.SignUp.Form"
        />
      )}
      <FormFields
        form={form}
        formData={signUpMarketingFormData}
        namespace="Auth.Pages.SignUp.Form"
      />
      <div className="flex flex-col gap-4">
        {isCodeStep ? emailCode.captcha : captcha}
        <SubmitButton
          isSubmitting={isPending}
          spinnerPosition="start"
          label={t("submit")}
          className="w-full"
        />
      </div>
      <EmailCodeSwitch
        email={email}
        emailCode={emailCode}
        isCodeStep={isCodeStep}
        onSwitch={switchTo}
      />
    </BaseForm>
  );
}
