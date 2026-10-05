"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { BaseForm } from "@/auth/components/form/base-form";
import { PasswordInput } from "@/auth/components/form/password-input";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { SignInMethodsRemovedDialog } from "@/auth/components/sign-in-methods-removed-dialog";
import { STEP_LINK_BUTTON_CLASS } from "@/auth/components/step-link";
import type { EmailCode } from "@/auth/components/use-email-code";
import { UsernameHint } from "@/auth/components/username-hint";
import {
  EmailCodeField,
  useEmailCodeRefusal,
  useEmailCodeSchema,
} from "@/components/auth/email-code-field";
import { useAuthCaptcha } from "@/components/auth-captcha";
import {
  FormControl,
  FormDescription,
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
  isRejectedOAuthRequestError,
  readAuthPageContext,
} from "@/lib/auth/auth.utils";
import { rememberAuthEmailHintOnClick } from "@/lib/auth/auth-email-hint";
import { inputPasswordSchema } from "@/lib/auth/data";
import { finishAuthInPlace } from "@/lib/auth/finish-auth.client";
import type { SignInMethod } from "@/lib/utils/last-used-auth-method";

interface SignInFormProps {
  /** Confirmed on the step before this one. */
  email: string;
  /** Where a finished sign-in goes: the returnUrl or the OAuth request. */
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
  const emailT = useTranslations("Auth.Email.Form");
  const schemaT = useTranslations("Library.Auth.Schema");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const code = useEmailCodeSchema();
  const [isLeaving, setIsLeaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [prefersPassword, setPrefersPassword] = useState(
    initialMethod === "password",
  );
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("signin");
  const searchParams = useSearchParams();

  const wasCodeSent = emailCode.sentTo === email;
  const isCodeStep = (wasCodeSent || handedOver) && !prefersPassword;
  // Register's send failed: the field says so, and the resend is ready.
  const isCodeUnsent = isCodeStep && !wasCodeSent;
  // Why the step opened here; each field is described by it.
  const handoverNotice = handedOver
    ? t(
        isCodeUnsent
          ? "Handover.codeNotSentNotice"
          : isCodeStep
            ? "Handover.codeSent"
            : "Handover.password",
      )
    : undefined;
  // Read by the resolver, which validates whichever way the step finishes.
  const isCodeStepRef = useRef(isCodeStep);
  isCodeStepRef.current = isCodeStep;

  // The email is confirmed on the step before.
  const passwordStepSchema = z.object({
    currentPassword: inputPasswordSchema(schemaT),
    code: z.string(),
  });
  const codeStepSchema = z.object({ currentPassword: z.string(), code });
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
    },
  });

  const { isSubmitting } = form.formState;
  const isPending = isSubmitting || isLeaving;
  const codeRefusal = useEmailCodeRefusal({
    clear: () => form.setValue("code", ""),
    focus: () => form.setFocus("code"),
    // A submitting fieldset cannot receive focus.
    isLocked: isSubmitting,
  });

  // The step replaced the one the person was typing in, so focus follows.
  useMountEffect(() => {
    form.setFocus(isCodeStep ? "code" : "currentPassword");
  });

  const handleCodeSubmit = async (values: Values) => {
    track("Sign In", { provider: "email-otp" });
    const error = await emailCode.signInWithCode(email, values.code);
    if (error) {
      form.setError("code", { message: codeRefusal.refuse(error) });
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
          // Persistent session cookie (Max-Age). false → Better Auth omits
          // Max-Age; iOS then drops the cookie when it kills the PWA.
          rememberMe: true,
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
          returnUrl,
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

  // A code goes out only when it is asked for here or already went out on
  // Continue.
  const methodSwitch = isCodeStep ? (
    <button
      type="button"
      data-testid="auth-use-password"
      className={STEP_LINK_BUTTON_CLASS}
      onClick={() => switchTo("password")}
    >
      {emailT("usePasswordInstead")}
    </button>
  ) : wasCodeSent ? (
    <span>
      {emailT("codeStillWorks")}{" "}
      <button
        type="button"
        className={STEP_LINK_BUTTON_CLASS}
        onClick={() => switchTo("code")}
      >
        {emailT("useCodeInstead")}
      </button>
    </span>
  ) : (
    <button
      type="button"
      className={STEP_LINK_BUTTON_CLASS}
      disabled={emailCode.isSending}
      onClick={async () => {
        // The password step's widget covers it: one widget on the step, so a
        // visitor Cloudflare wants to see is not asked twice.
        await emailCode.sendCode(email, { runWithCaptcha });
        switchTo("code");
      }}
    >
      {emailCode.isSending
        ? emailT("emailCodeSending")
        : emailT("emailCodeInstead")}
    </button>
  );

  return (
    <BaseForm
      form={form}
      formRef={formRef}
      disabled={isLeaving}
      onSubmit={isCodeStep ? handleCodeSubmit : handlePasswordSubmit}
      onChange={onFormStart}
    >
      <UsernameHint email={email} />
      {isCodeStep ? (
        <Controller
          control={form.control}
          name="code"
          render={({ field, fieldState }) => (
            <EmailCodeField
              centered
              inputRef={field.ref}
              value={field.value}
              completedCodeRef={codeRefusal.completedCodeRef}
              onChange={(code) => {
                // Typing replaces the reason; checking for a whole code
                // while it is typed would only say it is not yet one.
                form.clearErrors("code");
                form.setValue("code", code);
              }}
              onComplete={() => {
                if (!isPending) formRef.current?.requestSubmit();
              }}
              onBlur={field.onBlur}
              error={
                fieldState.error?.message ??
                (isCodeUnsent ? t("Handover.codeNotSent") : undefined)
              }
              notice={handoverNotice}
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
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              {handoverNotice ? (
                // The item's gap and this margin match the form's gap.
                <FormDescription className="mb-1 text-center">
                  {handoverNotice}
                </FormDescription>
              ) : null}
              {/* The header and the address name the step; the field's name
                  is its placeholder. */}
              <FormLabel className="sr-only">
                {t("Fields.Password.label")}
              </FormLabel>
              <FormControl>
                <PasswordInput
                  data-testid="auth-field-currentPassword"
                  autoComplete="current-password"
                  placeholder={t("Fields.Password.label")}
                  className="text-center"
                  showLabel={authT("PasswordToggle.show")}
                  hideLabel={authT("PasswordToggle.hide")}
                  {...field}
                />
              </FormControl>
              <FormMessage className="text-center" />
            </FormItem>
          )}
        />
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
      {/* One row on wider screens; a link that does not fit (German, Spanish,
          or the longer "code still works" line) wraps whole onto its own row. */}
      <div className="text-muted-foreground flex flex-col items-center gap-2 text-center text-sm sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-3">
        {isCodeStep ? null : (
          <Link
            href={buildAuthPageUrl(
              "/forgot-password",
              readAuthPageContext(searchParams),
            )}
            // The address stays out of the URL, which reaches logs.
            onClick={(event) => rememberAuthEmailHintOnClick(event, email)}
            className={STEP_LINK_BUTTON_CLASS}
          >
            {t("forgotPassword")}
          </Link>
        )}
        {methodSwitch}
      </div>
      <SignInMethodsRemovedDialog removed={emailCode.removedSignInMethods} />
    </BaseForm>
  );
}
