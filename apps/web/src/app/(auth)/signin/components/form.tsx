"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";

import {
  AUTH_STEP_LINK_CLASS,
  AuthStepErrorLine,
  AuthStepLayout,
  AuthStepLinkSeparator,
} from "@/auth/components/auth-step-layout";
import { EmailChip } from "@/auth/components/email-chip";
import { EmailCodeSwitch } from "@/auth/components/email-code-switch";
import { BaseForm } from "@/auth/components/form/base-form";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { SignInMethodsRemovedDialog } from "@/auth/components/sign-in-methods-removed-dialog";
import type { EmailCode } from "@/auth/components/use-email-code";
import {
  EMAIL_CODE_LENGTH,
  EmailCodeInput,
  UNANSWERED_CODE_CHECK,
  useEmailCodeRefusal,
} from "@/components/auth/email-code-field";
import { PasswordInput } from "@/components/auth/password-input";
import { ResendCodeButton } from "@/components/auth/resend-code-button";
import { useAuthCaptcha } from "@/components/auth-captcha";
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
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";
import { signInFormSchema } from "@/lib/schemas/auth";
import type { SignInMethod } from "@/lib/utils/last-used-auth-method";

interface SignInFormProps {
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
  /** Confirmed on the step before this one. */
  email: string;
  /** Back to the email step; absent when an invitation fixes the address. */
  onChangeEmail?: (() => void) | undefined;
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
  /** At the foot of the step, e.g. the terms notice. */
  children?: ReactNode;
}

/**
 * Second sign-in step: the code step 1 emailed, or the password. It opens on
 * the way this browser signed in last, and on the password when no code went
 * out, unless Register handed the address over. Either is one switch away.
 * The code needs no button: the sixth digit logs in. The password's Log in
 * button carries the only progress, and a refusal shows under the field.
 */
export default function SignInForm({
  client,
  email,
  onChangeEmail,
  returnUrl,
  initialMethod,
  handedOver = false,
  emailCode,
  onFormStart,
  children,
}: SignInFormProps) {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const emailT = useTranslations("Auth.Email.Form");
  const codeT = useTranslations("Components.EmailCodeForm");
  const schemaT = useTranslations("Library.Auth.Schema");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const [isLeaving, setIsLeaving] = useState(false);
  const noticeId = useId();
  const statusId = useId();
  const passwordErrorId = useId();
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
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );

  const wasCodeSent = emailCode.sentTo === email;
  const isCodeStep = (wasCodeSent || handedOver) && !prefersPassword;
  // Register's send failed: the status line says so, and the resend is ready.
  const isCodeUnsent = isCodeStep && !wasCodeSent;
  // Why the step opened here; the field is described by it.
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
    },
  });

  const { isSubmitting, errors } = form.formState;
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
    let error: Awaited<ReturnType<EmailCode["signInWithCode"]>>;
    try {
      error = await emailCode.signInWithCode(email, values.code);
    } catch {
      error = UNANSWERED_CODE_CHECK;
    }
    if (error) {
      form.setError("code", { message: codeRefusal.refuse(error) });
      return;
    }
    // The page is leaving; keep the step locked until it has.
    setIsLeaving(true);
  };

  const handlePasswordSubmit = async (values: Values) => {
    track("Sign In", { provider: "credential" });

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
        const errorCode =
          "code" in result.error ? result.error.code : undefined;
        const message = isRejectedOAuthRequestError(result.error)
          ? oauthT("errorDescription")
          : errorCode === AuthErrorCode.TERMS_NOT_ACCEPTED
            ? t("Errors.termsNotAccepted")
            : getErrorMessage(result.error, result.error.message ?? t("error"));
        // Only a wrong password is the field's; an expired request, the
        // terms or the Security check share its line without marking it.
        form.setError(
          errorCode === AuthErrorCode.INVALID_EMAIL_OR_PASSWORD
            ? "currentPassword"
            : "root.submit",
          { message },
        );
        return;
      }

      // No `callbackURL`: Better Auth would hard-redirect through a callback
      // page. Like passkey, finish in place and leave with a full document
      // load — a soft nav is served the pre-login middleware redirect.
      setIsLeaving(true);
      await finishAuthInPlace({
        eventType: "signIn",
        provider: "credential",
        returnUrl: effectiveReturnUrl,
        result: result.data,
      });
    });
  };

  const switchTo = (method: SignInMethod) => {
    form.clearErrors(method === "code" ? "currentPassword" : "code");
    setPrefersPassword(method === "password");
  };

  const codeError = errors.code?.message;
  const passwordError = errors.currentPassword?.message;
  const submitError = errors.root?.submit?.message;
  const passwordLine = passwordError ?? submitError;
  const step = isCodeStep
    ? {
        title: t("CodeStep.title"),
        subtitle: codeT("sentTo"),
        status:
          isLeaving || emailCode.isAccepted
            ? t("CodeStep.accepted")
            : isSubmitting
              ? codeT("checking")
              : (codeError ?? (isCodeUnsent ? codeT("notSent") : undefined)),
        statusIsError: !isPending && (codeError !== undefined || isCodeUnsent),
        links: (
          <>
            <ResendCodeButton
              sentAt={emailCode.sentAt}
              onResend={() => {
                void emailCode.sendCode(email);
              }}
              isSending={emailCode.isSending || isPending}
            />
            <AuthStepLinkSeparator />
            <button
              type="button"
              data-testid="auth-use-password"
              className={AUTH_STEP_LINK_CLASS}
              disabled={isPending}
              onClick={() => switchTo("password")}
            >
              {emailT("usePassword")}
            </button>
          </>
        ),
      }
    : {
        title: t("PasswordStep.title"),
        subtitle: t("PasswordStep.subtitle"),
        status: undefined,
        statusIsError: false,
        links: (
          <>
            <Link
              href={buildAuthPageUrl(
                "/forgot-password",
                readAuthPageContext(searchParams),
              )}
              // The address stays out of the URL, which reaches logs.
              onClick={(event) => rememberAuthEmailHintOnClick(event, email)}
              className={AUTH_STEP_LINK_CLASS}
            >
              {t("forgotPassword")}
            </Link>
            <AuthStepLinkSeparator />
            <EmailCodeSwitch
              email={email}
              emailCode={emailCode}
              disabled={isPending}
              onSwitchToCode={() => switchTo("code")}
            />
          </>
        ),
      };

  return (
    <AuthStepLayout
      client={client}
      title={step.title}
      subtitle={step.subtitle}
      chip={
        <EmailChip
          email={email}
          onChange={onChangeEmail}
          disabled={isPending}
        />
      }
      notice={handoverNotice}
      noticeId={noticeId}
      status={step.status}
      statusId={statusId}
      statusIsError={step.statusIsError}
      securityCheck={emailCode.captcha}
      links={step.links}
      footer={children}
    >
      <BaseForm
        form={form}
        formRef={formRef}
        disabled={isLeaving}
        onSubmit={isCodeStep ? handleCodeSubmit : handlePasswordSubmit}
        onChange={onFormStart}
        className="w-full"
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
        {isCodeStep ? (
          <Controller
            control={form.control}
            name="code"
            render={({ field }) => (
              <EmailCodeInput
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
                invalid={codeError !== undefined}
                describedBy={[
                  handoverNotice ? noticeId : null,
                  codeError || isCodeUnsent ? statusId : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={isPending}
              />
            )}
          />
        ) : (
          <>
            <Controller
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <PasswordInput
                  {...field}
                  onChange={(event) => {
                    // Typing replaces a refusal the field did not cause.
                    form.clearErrors("root");
                    field.onChange(event);
                  }}
                  variant="underlined"
                  data-testid="auth-field-currentPassword"
                  autoComplete="current-password"
                  placeholder={t("Fields.Password.label")}
                  aria-label={t("Fields.Password.label")}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={
                    [
                      handoverNotice ? noticeId : null,
                      passwordLine ? passwordErrorId : null,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                />
              )}
            />
            <AuthStepErrorLine id={passwordErrorId}>
              {passwordLine}
            </AuthStepErrorLine>
            <div className="mt-3 flex flex-col gap-4">
              {captcha}
              <SubmitButton
                isSubmitting={isPending}
                spinnerPosition="start"
                label={t("submit")}
                className="w-full"
                data-testid="auth-submit"
              />
            </div>
          </>
        )}
        <SignInMethodsRemovedDialog removed={emailCode.removedSignInMethods} />
      </BaseForm>
    </AuthStepLayout>
  );
}
