"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { joinFirstAndLastName } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import Divider from "@/auth/components/divider";
import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { useEmailCode } from "@/auth/components/use-email-code";
import {
  signUpMarketingFormData,
  signUpNameFormData,
  signUpPasswordFormData,
} from "@/auth/signup/data";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { Button } from "@/components/ui/button";
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

/**
 * Second sign-up step: name and password for a known email, or name and an
 * emailed code instead of the password.
 */
export default function SignUpForm({
  email,
  returnUrl,
  onFormStart,
  onPendingChange,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const [isLeaving, setIsLeaving] = useState(false);
  const [wantsEmailCode, setWantsEmailCode] = useState(false);
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

  const emailCode = useEmailCode({
    eventType: "signUp",
    returnUrl: effectiveReturnUrl,
    // Record UTM attribution for every successful signup.
    beforeLeaving: handleUtmConversion,
  });
  const isCodeStep = wantsEmailCode && emailCode.sentTo === email;

  const handleEmailCodeInstead = async () => {
    // The code creates the account, so the names it carries come first.
    if (!(await form.trigger(["firstName", "lastName"]))) {
      return;
    }
    setWantsEmailCode(true);
    await emailCode.sendCode(email);
  };

  const handleEmailCodeSubmit = async (code: string) => {
    // A name emptied after sending fails beside its own field.
    if (
      !(await form.trigger(["firstName", "lastName"], { shouldFocus: true }))
    ) {
      return false;
    }
    const { firstName, lastName, marketingOptIn } = form.getValues();
    return emailCode.signInWithCode(email, code, {
      firstName,
      lastName,
      // Unset is a no; Better Auth's own default would be yes.
      marketingOptIn: marketingOptIn ?? false,
      termsAccepted: true,
    });
  };

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
    <>
      <BaseForm form={form} onSubmit={handleSubmit} onChange={onFormStart}>
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
        {isCodeStep ? null : (
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
        {isCodeStep ? null : (
          <div className="flex flex-col gap-4">
            {captcha}
            <SubmitButton
              isSubmitting={isPending}
              spinnerPosition="start"
              label={t("submit")}
              className="w-full"
            />
          </div>
        )}
      </BaseForm>
      {isCodeStep ? (
        <div className="flex flex-col gap-2">
          {emailCode.captcha}
          <EmailCodeForm
            email={email}
            submitLabel={t("submit")}
            onSubmitCode={handleEmailCodeSubmit}
            onResend={() => {
              void emailCode.sendCode(email);
            }}
            isResending={emailCode.isSending}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => setWantsEmailCode(false)}
          >
            {t("usePasswordInstead")}
          </Button>
        </div>
      ) : (
        <>
          <Divider labelKey="emailCodeDivider" />
          <div className="flex flex-col gap-2">
            {emailCode.captcha}
            <Button
              type="button"
              variant="secondary"
              className="text-foreground bg-senary hover:bg-quinary h-[50px] w-full justify-center gap-2 rounded-md border border-transparent px-4 py-2 text-sm font-normal shadow-none"
              disabled={emailCode.isSending || isPending}
              onClick={() => {
                void handleEmailCodeInstead();
              }}
            >
              <Mail className="size-4" />
              {emailCode.isSending
                ? t("emailCodeSending")
                : t("emailCodeInstead")}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
