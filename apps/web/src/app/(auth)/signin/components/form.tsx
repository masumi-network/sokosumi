"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { EmailCodeSwitch } from "@/auth/components/email-code-switch";
import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { PasswordInput } from "@/auth/components/form/password-input";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { SignInMethodsRemovedDialog } from "@/auth/components/sign-in-methods-removed-dialog";
import type { EmailCode } from "@/auth/components/use-email-code";
import { signInRememberMeFormData } from "@/auth/signin/data";
import {
  EMAIL_CODE_LENGTH,
  EmailCodeField,
  useDescribeEmailCodeError,
} from "@/components/auth/email-code-field";
import { useAuthCaptcha } from "@/components/auth-captcha";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { AuthErrorCode } from "@/lib/actions/errors/error-codes/auth";
import { signIn } from "@/lib/auth/auth.client";
import {
  buildAuthPageUrl,
  buildOAuthResumeUrlFromSearchParams,
  isRejectedOAuthRequestError,
  readAuthPageContext,
} from "@/lib/auth/auth.utils";
import { rememberAuthEmailHintOnClick } from "@/lib/auth/auth-email-hint";
import { finishAuthInPlace } from "@/lib/auth/finish-auth.client";
import { signInFormSchema } from "@/lib/schemas/auth";
import type { SignInMethod } from "@/lib/utils/last-used-auth-method";

interface SignInFormProps {
  /** Confirmed on the step before this one. */
  email: string;
  returnUrl?: string | undefined;
  /** The way this browser signed in last; the code when it is not known. */
  initialMethod: SignInMethod;
  /**
   * Register found an account and sent the person here: the step says so,
   * and opens on the code even when Register could not send it.
   */
  handedOver?: boolean | undefined;
  /** The code step 1 sent to `email`, if it went out. */
  emailCode: EmailCode;
  onFormStart: () => void;
  onPendingChange: (pending: boolean) => void;
}

/**
 * Second sign-in step: the code step 1 emailed, or the password. It opens on
 * the way this browser signed in last, and on the password when no code went
 * out, unless Register handed the address over. Either is one switch away.
 */
export default function SignInForm({
  email,
  returnUrl,
  initialMethod,
  handedOver = false,
  emailCode,
  onFormStart,
  onPendingChange,
}: SignInFormProps) {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const authT = useTranslations("Auth");
  const codeT = useTranslations("Components.EmailCodeForm");
  const schemaT = useTranslations("Library.Auth.Schema");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const describeCodeError = useDescribeEmailCodeError();
  const [isLeaving, setIsLeaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const completedCodeRef = useRef("");
  const [prefersPassword, setPrefersPassword] = useState(
    initialMethod === "password",
  );
  const [refusedCode, setRefusedCode] = useState(0);
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("signin");
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );

  const wasCodeSent = emailCode.sentTo === email;
  const isCodeStep = (wasCodeSent || handedOver) && !prefersPassword;
  // Register's send failed: the field says so, and the resend is ready.
  const isCodeUnsent = isCodeStep && !wasCodeSent;
  // Read by the resolver, which validates whichever way the step finishes.
  const isCodeStepRef = useRef(isCodeStep);
  isCodeStepRef.current = isCodeStep;

  const passwordStepSchema = signInFormSchema(schemaT).safeExtend({
    code: z.string(),
  });
  const codeStepSchema = signInFormSchema(schemaT).safeExtend({
    currentPassword: z.string(),
    code: z
      .string()
      .length(EMAIL_CODE_LENGTH, { message: codeT("incomplete") }),
  });
  type Values = z.infer<typeof passwordStepSchema>;
  const form = useForm<Values>({
    resolver: (values, context, options) =>
      zodResolver(isCodeStepRef.current ? codeStepSchema : passwordStepSchema)(
        values,
        context,
        options,
      ),
    defaultValues: {
      currentPassword: "",
      code: "",
      // Persistent session cookie (Max-Age). false → Better Auth omits Max-Age;
      // iOS then drops the cookie when it kills the PWA after backgrounding.
      rememberMe: true,
    },
  });

  // The step replaced the one the person was typing in, so focus follows.
  useMountEffect(() => {
    form.setFocus(isCodeStep ? "code" : "currentPassword");
  });

  const handleCodeSubmit = async (values: Values) => {
    track("Sign In", { provider: "email-otp" });
    const error = await emailCode.signInWithCode(email, values.code);
    if (error) {
      form.setError("code", { message: describeCodeError(error) });
      setRefusedCode((count) => count + 1);
      return;
    }
    // The page is leaving; keep the step locked until it has.
    setIsLeaving(true);
    onPendingChange(true);
  };

  const handlePasswordSubmit = async (values: Values) => {
    track("Sign In", { provider: "credential" });

    onPendingChange(true);
    let willLeave = false;
    try {
      await runWithCaptcha(async (fetchOptions) => {
        const result = await signIn.email({
          fetchOptions,
          email,
          password: values.currentPassword,
          rememberMe: values.rememberMe,
        });

        if (result.error) {
          if (isRejectedOAuthRequestError(result.error)) {
            toast.error(oauthT("errorDescription"));
            return;
          }

          const errorCode =
            "code" in result.error ? result.error.code : undefined;

          switch (errorCode) {
            case AuthErrorCode.TERMS_NOT_ACCEPTED:
              toast.error(t("Errors.termsNotAccepted"));
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

        // No `callbackURL`: Better Auth would hard-redirect through a callback
        // page. Like passkey, finish in place and leave with a full document
        // load — a soft nav is served the pre-login middleware redirect.
        willLeave = true;
        setIsLeaving(true);
        await finishAuthInPlace({
          eventType: "signIn",
          provider: "credential",
          returnUrl: effectiveReturnUrl,
          result: result.data,
        });
      });
    } finally {
      // Keep the flow locked after success until the page navigates away.
      if (!willLeave) onPendingChange(false);
    }
  };

  const switchTo = (method: SignInMethod) => {
    form.clearErrors(method === "code" ? "currentPassword" : "code");
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
      formRef={formRef}
      disabled={isLeaving}
      onSubmit={isCodeStep ? handleCodeSubmit : handlePasswordSubmit}
      onChange={onFormStart}
    >
      {/* Password managers pair the password with this address. */}
      <input
        data-testid="auth-field-username"
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
      {handedOver ? (
        <p className="text-muted-foreground text-sm">
          {t(
            isCodeUnsent
              ? "Handover.codeNotSentNotice"
              : isCodeStep
                ? "Handover.codeSent"
                : "Handover.password",
          )}
        </p>
      ) : null}
      {isCodeStep ? (
        <Controller
          control={form.control}
          name="code"
          render={({ field, fieldState }) => (
            <EmailCodeField
              inputRef={field.ref}
              value={field.value}
              completedCodeRef={completedCodeRef}
              onChange={field.onChange}
              onComplete={() => {
                if (!isPending) formRef.current?.requestSubmit();
              }}
              onBlur={field.onBlur}
              error={
                fieldState.error?.message ??
                (isCodeUnsent ? t("Handover.codeNotSent") : undefined)
              }
              unsent={isCodeUnsent}
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
        <>
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <FormLabel>{t("Fields.Password.label")}</FormLabel>
                  <Link
                    href={buildAuthPageUrl(
                      "/forgot-password",
                      readAuthPageContext(searchParams),
                    )}
                    // The address stays out of the URL, which reaches logs.
                    onClick={(event) =>
                      rememberAuthEmailHintOnClick(event, email)
                    }
                    className="text-muted-foreground hover:text-foreground text-sm hover:underline"
                  >
                    {t("forgotPassword")}
                  </Link>
                </div>
                <FormControl>
                  <PasswordInput
                    data-testid="auth-field-currentPassword"
                    autoComplete="current-password"
                    showLabel={authT("PasswordToggle.show")}
                    hideLabel={authT("PasswordToggle.hide")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormFields
            form={form}
            formData={signInRememberMeFormData}
            namespace="Auth.Pages.SignIn.Form"
          />
        </>
      )}
      <div className="flex flex-col gap-4">
        {isCodeStep ? emailCode.captcha : captcha}
        <SubmitButton
          isSubmitting={isPending}
          spinnerPosition="start"
          label={t("submit")}
          className="w-full"
          data-testid="auth-submit"
        />
      </div>
      <EmailCodeSwitch
        email={email}
        emailCode={emailCode}
        isCodeStep={isCodeStep}
        onSwitch={switchTo}
      />
      <SignInMethodsRemovedDialog removed={emailCode.removedSignInMethods} />
    </BaseForm>
  );
}
