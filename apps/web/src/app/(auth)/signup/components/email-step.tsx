"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
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
import { rememberSignInEmailHint } from "@/lib/auth/sign-in-email-hint";
import {
  type SignUpEmailFormSchemaType,
  signUpEmailFormSchema,
} from "@/lib/schemas/auth";
import { cn } from "@/lib/utils";

import { useSignInHref } from "./sign-in-link";

// 200ms ease-out is the project default. Under reduced motion the two states
// swap at once; the notice itself is the cue that something changed.
const MOTION = "duration-200 ease-out motion-reduce:transition-none";

// "Log in" takes the exact place of the button that was just pressed. A second
// click of a double-click must not follow it.
const LOG_IN_GRACE_MS = 400;

interface SignUpEmailStepProps {
  defaultEmail: string;
  /** An invitation fixes the address; the user can only confirm it. */
  emailLocked: boolean;
  /** Set when the user came back here from the next step. */
  autoFocus: boolean;
  onFormStart: () => void;
  /** Runs while the button still spins, e.g. to email a code. */
  onContinue: (email: string) => Promise<void> | void;
  /** The check the work after Continue needs, shown beside this step's. */
  continueCaptcha?: ReactNode;
}

/**
 * First sign-up step. It asks Core whether the address already has an
 * account, so that person is pointed at sign-in instead of being asked for a
 * name and a password first.
 *
 * When it does, the button stays where it is and a notice grows around it:
 * title and description unfold above, a frame fades in, and the button
 * becomes "Log in". Editing the address plays it back.
 */
export function SignUpEmailStep({
  defaultEmail,
  emailLocked,
  autoFocus,
  onFormStart,
  onContinue,
  continueCaptcha,
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
  const accountExistsSince = useRef(0);
  const signInLinkRef = useRef<HTMLAnchorElement>(null);
  const noticeId = useId();
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

  const { isSubmitting } = form.formState;

  // The pressed button went inert, so focus moves to the one that took its
  // place. A submitting fieldset cannot receive focus; wait until it is
  // enabled again.
  useEffect(() => {
    if (!accountExists || isSubmitting) return;
    signInLinkRef.current?.focus();
  }, [accountExists, isSubmitting]);

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
        accountExistsSince.current = performance.now();
        setAccountExists(true);
        return;
      }

      await onContinue(email);
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
      {/* Announces the notice. The visible copy below is the same text, so
          it is hidden from assistive technology rather than read twice. */}
      <p id={noticeId} role="status" className="sr-only">
        {accountExists
          ? `${t("AccountExists.title")}. ${t("AccountExists.description")}`
          : null}
      </p>
      <div
        data-testid="sign-up-account-exists"
        data-state={accountExists ? "open" : "closed"}
        className={cn(
          // A ring, not a border: it takes no space, so the button below is
          // as wide as the field above it while the notice is closed.
          "rounded-lg text-sm ring-1 ring-inset transition-[padding,box-shadow,background-color]",
          MOTION,
          accountExists
            ? "bg-card px-4 pt-3 pb-4 ring-border"
            : "ring-transparent",
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "grid transition-[grid-template-rows,opacity]",
            MOTION,
            accountExists ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid gap-0.5 pb-3">
              <p className="font-medium tracking-tight">
                {t("AccountExists.title")}
              </p>
              <p className="text-muted-foreground">
                {t("AccountExists.description")}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {captcha}
          {continueCaptcha}
          {/* Both controls share one cell. The submit button stays underneath
              and the link fades in over it, so the fill never dips. The
              submit button is positioned (for its spinner), so the link must
              be too, or it would paint below. */}
          <div className="grid">
            <SubmitButton
              isSubmitting={isSubmitting}
              spinnerPosition="start"
              label={t("continueWithEmail")}
              className="col-start-1 row-start-1 w-full"
              inert={accountExists}
            />
            <Button
              asChild
              variant="primary"
              className={cn(
                "relative col-start-1 row-start-1 w-full transition-[opacity,color,background-color,border-color,box-shadow,transform] motion-reduce:transition-none",
                !accountExists && "opacity-0",
              )}
            >
              <Link
                ref={signInLinkRef}
                href={signInHref}
                inert={!accountExists}
                aria-describedby={accountExists ? noticeId : undefined}
                onClick={(event) => {
                  const shownFor =
                    performance.now() - accountExistsSince.current;
                  if (shownFor < LOG_IN_GRACE_MS) {
                    event.preventDefault();
                    return;
                  }
                  rememberSignInEmailHint(form.getValues("email"));
                }}
              >
                {t("AccountExists.logIn")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </BaseForm>
  );
}
