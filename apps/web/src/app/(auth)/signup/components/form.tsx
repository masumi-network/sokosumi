"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
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
import { FirstAndLastNameFields } from "@/components/auth/first-and-last-name-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { AuthErrorCode } from "@/lib/actions/errors/error-codes/auth";
import { isRejectedOAuthRequestError } from "@/lib/auth/auth.utils";
import { rememberAuthEmailHintOnClick } from "@/lib/auth/auth-email-hint";
import type { FormData } from "@/lib/form";
import {
  type SignUpFormSchemaType,
  signUpFormSchema,
} from "@/lib/schemas/auth";

import { useSignInHref } from "./sign-in-link";

type SignUpFormData = FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form">;

// An email code replaces the password, so the two are rendered apart.
const signUpPasswordFormData: SignUpFormData = [
  {
    name: "password",
    labelKey: "Fields.Password.label",
    // Shown up front, so the rule is known before a submit fails on it.
    descriptionKey: "Fields.Password.description",
    type: "password",
    autoComplete: "new-password",
  },
];

const signUpMarketingFormData: SignUpFormData = [
  {
    name: "marketingOptIn",
    type: "checkbox",
    labelKey: "Fields.MarketingOptIn.label",
  },
];

interface SignUpFormProps {
  /** Confirmed on the step before this one. */
  email: string;
  /** The code step 1 sent to `email`, if it went out. */
  emailCode: EmailCode;
  onFormStart: () => void;
  onPendingChange: (pending: boolean) => void;
}

/**
 * Second sign-up step. Step 1 has emailed a code, so this asks for the name
 * and that code, with one Register; a whole code waits for it. A password is
 * a deliberate addition, sent with the code: the code proves the address, so
 * no account starts with an unproven one. When the first code did not go out,
 * the field sends another.
 */
export default function SignUpForm({
  email,
  emailCode,
  onFormStart,
  onPendingChange,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const schemaT = useTranslations("Library.Auth.Schema");
  const oauthT = useTranslations("Auth.OAuthHandBack");
  const [isLeaving, setIsLeaving] = useState(false);
  const [withPassword, setWithPassword] = useState(false);
  // Step 1 found no account, but one can appear since, e.g. through Google
  // in another tab.
  const [accountExists, setAccountExists] = useState(false);
  const signInHref = useSignInHref();

  // Read by the resolver, which validates whichever way the step finishes.
  const withPasswordRef = useRef(withPassword);
  withPasswordRef.current = withPassword;

  const code = useEmailCodeSchema();
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
  });

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
    // The address stays fixed while the account is being created.
    onPendingChange(true);
    const error = await emailCode.signInWithCode(email, values.code, {
      firstName: values.firstName,
      lastName: values.lastName,
      // Unset is a no; Better Auth's own default would be yes.
      marketingOptIn: values.marketingOptIn ?? false,
      termsAccepted: true,
      ...(withPassword ? { password: values.password } : {}),
    });
    if (error) {
      onPendingChange(false);
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

  return (
    <BaseForm
      form={form}
      disabled={isLeaving}
      onSubmit={handleSubmit}
      onChange={onFormStart}
    >
      <UsernameHint email={email} />
      <FirstAndLastNameFields
        control={form.control}
        testIdPrefix="auth-field"
        namesInside
      />
      {withPassword ? (
        <FormFields
          form={form}
          formData={signUpPasswordFormData}
          namespace="Auth.Pages.SignUp.Form"
        />
      ) : null}
      {/* The updates choice closes the profile; the code and Register below
          are one motion. */}
      <FormFields
        form={form}
        formData={signUpMarketingFormData}
        namespace="Auth.Pages.SignUp.Form"
      />
      <Separator />
      <Controller
        control={form.control}
        name="code"
        render={({ field, fieldState }) => (
          <EmailCodeField
            centered
            inputRef={field.ref}
            value={field.value}
            // No onComplete: "Add a password" sits below Register, so only
            // Register sends the code.
            onChange={(code) => {
              // Typing replaces the reason; checking for a whole code while
              // it is typed would only say it is not yet one.
              form.clearErrors("code");
              form.setValue("code", code);
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
      {accountExists ? (
        <Alert>
          <AlertTitle>{t("AccountExists.title")}</AlertTitle>
          <AlertDescription>
            <p>{t("AccountExists.description")}</p>
            <Link
              href={signInHref}
              // Sign-in ignores it when an invitation locks the address.
              onClick={(event) => rememberAuthEmailHintOnClick(event, email)}
              className="text-primary font-medium hover:underline"
            >
              {t("AccountExists.logIn")}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-4">
        {emailCode.captcha}
        <SubmitButton
          isSubmitting={isPending}
          spinnerPosition="start"
          label={t("submit")}
          className="w-full"
        />
      </div>
      <div className="text-center">
        <button
          type="button"
          className={STEP_LINK_BUTTON_CLASS}
          disabled={isPending}
          onClick={togglePassword}
        >
          {withPassword ? t("removePassword") : t("addPassword")}
        </button>
      </div>
      <SignInMethodsRemovedDialog removed={emailCode.removedSignInMethods} />
    </BaseForm>
  );
}
