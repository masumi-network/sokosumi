"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import {
  AUTH_STEP_LINK_CLASS,
  AuthStepLayout,
  AuthStepLinkSeparator,
} from "@/auth/components/auth-step-layout";
import { EmailChip } from "@/auth/components/email-chip";
import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { SignInMethodsRemovedDialog } from "@/auth/components/sign-in-methods-removed-dialog";
import type { EmailCode } from "@/auth/components/use-email-code";
import { signUpMarketingFormData } from "@/auth/signup/data";
import {
  EMAIL_CODE_LENGTH,
  EmailCodeInput,
  useEmailCodeRefusal,
} from "@/components/auth/email-code-field";
import { FirstAndLastNameFields } from "@/components/auth/first-and-last-name-fields";
import { PasswordInput } from "@/components/auth/password-input";
import { ResendCodeButton } from "@/components/auth/resend-code-button";
import { FormControl, FormField, FormItem } from "@/components/ui/form";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { AuthErrorCode } from "@/lib/actions/errors/error-codes/auth";
import { isRejectedOAuthRequestError } from "@/lib/auth/auth.utils";
import { rememberAuthEmailHintOnClick } from "@/lib/auth/auth-email-hint";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";
import { signUpFormSchema } from "@/lib/schemas/auth";
import { cn } from "@/lib/utils";

import { useSignInHref } from "./sign-in-link";

/** The fields the error line explains, in the order they appear. */
const ERROR_LINE_ORDER = ["firstName", "lastName", "password", "code"] as const;

interface SignUpFormProps {
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
  /** Confirmed on the step before this one. */
  email: string;
  /** Back to the email step; absent when an invitation fixes the address. */
  onChangeEmail?: (() => void) | undefined;
  /** The code step 1 sent to `email`, if it went out. */
  emailCode: EmailCode;
  onFormStart: () => void;
  /** At the foot of the page, e.g. the terms notice. */
  children?: ReactNode;
}

/**
 * Second sign-up step. Step 1 has emailed a code, so this asks for the name
 * and that code, with one Register; a whole code waits for it. A password is
 * a deliberate addition, sent with the code: the code proves the address, so
 * no account starts with an unproven one. When the first code did not go out,
 * the error line says so and the links row sends another at once.
 *
 * It has one error line, between the code and Register: the first refused
 * field's reason, then an existing account, then an unsent code. The refused
 * fields are marked and described by it.
 */
export default function SignUpForm({
  client,
  email,
  onChangeEmail,
  emailCode,
  onFormStart,
  children,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const codeT = useTranslations("Components.EmailCodeForm");
  const schemaT = useTranslations("Library.Auth.Schema");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const passwordHintId = useId();
  const errorLineId = useId();
  const [isLeaving, setIsLeaving] = useState(false);
  const [withPassword, setWithPassword] = useState(false);
  // Step 1 found no account, but one can appear since, e.g. through Google
  // in another tab.
  const [accountExists, setAccountExists] = useState(false);
  const signInHref = useSignInHref();

  // Read by the resolver, which validates whichever way the step finishes.
  const withPasswordRef = useRef(withPassword);
  withPasswordRef.current = withPassword;

  const code = z
    .string()
    .length(EMAIL_CODE_LENGTH, { message: codeT("incomplete") });
  const passwordSchema = signUpFormSchema(schemaT).safeExtend({ code });
  const codeOnlySchema = signUpFormSchema(schemaT).safeExtend({
    password: z.string(),
    code,
  });
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: (values, context, options) =>
      zodResolver(withPasswordRef.current ? passwordSchema : codeOnlySchema)(
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
    // React Hook Form would focus in the order fields mounted, which puts a
    // password added later after the code; focus follows the error line.
    shouldFocusError: false,
  });

  // After the submit unlocks the fieldset, as React Hook Form does.
  function focusLineField(name: (typeof ERROR_LINE_ORDER)[number]) {
    setTimeout(() => form.setFocus(name));
  }

  const { isSubmitting } = form.formState;
  const isPending = isSubmitting || isLeaving;
  const codeRefusal = useEmailCodeRefusal({
    clear: () => form.setValue("code", ""),
    focus: () => form.setFocus("code"),
    // A submitting fieldset cannot receive focus.
    isLocked: isSubmitting,
  });

  // The step replaced the one the user was typing in, so focus follows.
  useMountEffect(() => {
    form.setFocus("firstName");
  });

  const handleSubmit = async (values: z.infer<typeof passwordSchema>) => {
    track("Sign Up", { provider: withPassword ? "credential" : "email-otp" });
    setAccountExists(false);
    const error = await emailCode.signInWithCode(email, values.code, {
      firstName: values.firstName,
      lastName: values.lastName,
      // Unset is a no; Better Auth's own default would be yes.
      marketingOptIn: values.marketingOptIn ?? false,
      termsAccepted: true,
      ...(withPassword ? { password: values.password } : {}),
    });
    if (error) {
      if (isRejectedOAuthRequestError(error)) {
        toast.error(oauthT("errorDescription"));
        return;
      }
      // Core refused these before spending the code.
      if (error.code === AuthErrorCode.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL) {
        setAccountExists(true);
        return;
      }
      if (
        error.code === "PASSWORD_TOO_SHORT" ||
        error.code === "PASSWORD_TOO_LONG"
      ) {
        form.setError("password", {
          message: schemaT(
            error.code === "PASSWORD_TOO_SHORT"
              ? "Password.min"
              : "Password.max",
          ),
        });
        focusLineField("password");
        return;
      }
      form.setError("code", { message: codeRefusal.refuse(error) });
      return;
    }
    // The page is leaving; keep the step locked until it has.
    setIsLeaving(true);
  };

  const togglePassword = () => {
    form.clearErrors("password");
    setWithPassword((current) => !current);
  };

  const { errors } = form.formState;
  // The field the error line explains: the first refused one on screen.
  const lineField = ERROR_LINE_ORDER.find((name) => errors[name]);
  const fieldError = lineField ? errors[lineField]?.message : undefined;
  // Step 1 said so already when the send failed; resend works at once.
  const isCodeUnsent = emailCode.sentTo !== email && !emailCode.isSending;
  const isLineAboutUnsentCode = !lineField && !accountExists && isCodeUnsent;
  const errorLine =
    fieldError ??
    (accountExists ? (
      <>
        {t("AccountExists.message")}{" "}
        <Link
          href={signInHref}
          // Sign-in ignores it when an invitation locks the address.
          onClick={(event) => rememberAuthEmailHintOnClick(event, email)}
          className={cn(
            AUTH_STEP_LINK_CLASS,
            "whitespace-nowrap text-current hover:text-current",
          )}
        >
          {t("AccountExists.logIn")}
        </Link>
      </>
    ) : isCodeUnsent && !isPending ? (
      codeT("notSent")
    ) : null);

  return (
    <AuthStepLayout
      client={client}
      title={t("title")}
      subtitle={codeT("sentTo")}
      chip={
        <EmailChip
          email={email}
          onChange={onChangeEmail}
          // A late reply for this address would mark the next one's code
          // as unsent.
          disabled={isPending || emailCode.isSending}
        />
      }
      links={
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
            className={AUTH_STEP_LINK_CLASS}
            disabled={isPending}
            onClick={togglePassword}
          >
            {withPassword ? t("removePassword") : t("addPassword")}
          </button>
        </>
      }
      footer={children}
    >
      <BaseForm
        form={form}
        disabled={isLeaving}
        onSubmit={handleSubmit}
        onInvalid={(refused) => {
          const first = ERROR_LINE_ORDER.find((name) => refused[name]);
          if (first) focusLineField(first);
        }}
        onChange={onFormStart}
        className="w-full"
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
        <FirstAndLastNameFields
          control={form.control}
          testIdPrefix="auth-field"
          variant="underlined"
          // The names sit together, so both point at the line while it
          // explains either.
          describedBy={
            lineField === "firstName" || lineField === "lastName"
              ? errorLineId
              : undefined
          }
        />
        {withPassword ? (
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <PasswordInput
                    {...field}
                    variant="underlined"
                    data-testid="auth-field-password"
                    autoComplete="new-password"
                    placeholder={t("Fields.Password.label")}
                    aria-label={t("Fields.Password.label")}
                    aria-describedby={[
                      passwordHintId,
                      lineField === "password" ? errorLineId : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                </FormControl>
                {/* Shown up front, so the rule is known before Register. */}
                <p
                  id={passwordHintId}
                  className="text-muted-foreground text-center text-sm"
                >
                  {t("Fields.Password.description")}
                </p>
              </FormItem>
            )}
          />
        ) : null}
        <Controller
          control={form.control}
          name="code"
          render={({ field, fieldState }) => (
            <div className="mt-3">
              <EmailCodeInput
                inputRef={field.ref}
                value={field.value}
                // No onComplete: the updates checkbox comes after the code,
                // so only Register sends it.
                onChange={(code) => {
                  // Typing replaces the reason; checking for a whole code
                  // while it is typed would only say it is not yet one.
                  form.clearErrors("code");
                  form.setValue("code", code);
                }}
                onBlur={field.onBlur}
                invalid={Boolean(fieldState.error)}
                describedBy={
                  lineField === "code" || isLineAboutUnsentCode
                    ? errorLineId
                    : undefined
                }
                disabled={isPending}
              />
            </div>
          )}
        />
        {/* Always rendered, so a screen reader hears what appears in it. A
            div: it can hold the link to Log in. */}
        <div
          id={errorLineId}
          role="alert"
          className={
            errorLine ? "text-destructive text-center text-sm" : "sr-only"
          }
        >
          {errorLine}
        </div>
        <div className="mt-3 flex flex-col gap-4">
          {emailCode.captcha}
          <SubmitButton
            isSubmitting={isPending}
            spinnerPosition="start"
            label={t("submit")}
            className="w-full"
          />
          <div className="flex justify-center">
            <FormFields
              form={form}
              formData={signUpMarketingFormData}
              namespace="Auth.Pages.SignUp.Form"
            />
          </div>
        </div>
        <SignInMethodsRemovedDialog removed={emailCode.removedSignInMethods} />
      </BaseForm>
    </AuthStepLayout>
  );
}
