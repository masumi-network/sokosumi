"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import {
  AUTH_STEP_LINK_CLASS,
  AuthStepErrorLine,
  AuthStepLayout,
  AuthStepLinkSeparator,
} from "@/auth/components/auth-step-layout";
import { EmailChip } from "@/auth/components/email-chip";
import { BaseForm } from "@/auth/components/form/base-form";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { ResendCodeButton } from "@/components/auth/resend-code-button";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { requestPasswordReset } from "@/lib/auth/auth.client";
import {
  buildAuthPageUrl,
  getAbsoluteAuthRedirectUrl,
  readAuthPageContext,
} from "@/lib/auth/auth.utils";
import {
  rememberAuthEmailHintOnClick,
  takeAuthEmailHint,
} from "@/lib/auth/auth-email-hint";
import {
  type ForgotPasswordFormSchemaType,
  forgotPasswordFormSchema,
} from "@/lib/schemas/auth";

interface ForgotPasswordFormProps {
  /** The person followed a reset link that expired or was already used. */
  linkExpired?: boolean;
}

/**
 * Asks for the address and emails a link to set a new password, then says
 * where it went: "Check your email", with the address as a chip that goes
 * back to change it, and the link sent again after the usual wait.
 */
export default function ForgotPasswordForm({
  linkExpired = false,
}: ForgotPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
  const headerT = useTranslations("Auth.Pages.ForgotPassword.Header");
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("forgot-password");
  const context = readAuthPageContext(useSearchParams());
  const signInHref = buildAuthPageUrl("/signin", context);
  const errorLineId = useId();
  const statusId = useId();
  // The address the last link went to; the page then says to check it.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [cameBack, setCameBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(
      forgotPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: "",
    },
  });

  // Sign-in hands over the address it was given, outside the URL.
  useMountEffect(() => {
    const emailHint = takeAuthEmailHint();
    if (emailHint) {
      form.setValue("email", emailHint);
    }
  });

  async function sendLink(email: string) {
    setError(null);
    let sent = false;
    try {
      await runWithCaptcha(async (fetchOptions) => {
        const result = await requestPasswordReset({
          fetchOptions,
          email,
          // The emailed link returns to the sign-in this request started from.
          redirectTo: getAbsoluteAuthRedirectUrl(
            buildAuthPageUrl("/reset-password/exchange", context),
          ),
        });

        if (!result.error) {
          sent = true;
          return;
        }

        setError(
          result.error.status === 429
            ? t("Errors.rateLimited")
            : getErrorMessage(result.error, t("Errors.generic")),
        );
      });
    } catch {
      setError(t("Errors.generic"));
    }
    if (sent) {
      setSentTo(email);
      setSentAt(Date.now());
    }
  }

  async function handleSubmit(values: ForgotPasswordFormSchemaType) {
    await sendLink(values.email);
  }

  async function resend(email: string) {
    setIsResending(true);
    try {
      await sendLink(email);
    } finally {
      setIsResending(false);
    }
  }

  if (sentTo) {
    return (
      <AuthStepLayout
        title={t("Sent.title")}
        subtitle={t("Sent.subtitle")}
        chip={
          <EmailChip
            email={sentTo}
            onChange={() => {
              setError(null);
              setCameBack(true);
              setSentTo(null);
            }}
            disabled={isResending}
          />
        }
        status={error}
        statusId={statusId}
        statusIsError
        securityCheck={captcha}
        links={
          <>
            <ResendCodeButton
              sentAt={sentAt}
              onResend={() => {
                void resend(sentTo);
              }}
              isSending={isResending}
              labels={{
                resend: t("Sent.resend"),
                resendIn: (seconds) => t("Sent.resendIn", { seconds }),
              }}
            />
            <AuthStepLinkSeparator />
            <Link
              href={signInHref}
              onClick={(event) => rememberAuthEmailHintOnClick(event, sentTo)}
              className={AUTH_STEP_LINK_CLASS}
            >
              {t("Sent.backToLogIn")}
            </Link>
          </>
        }
      >
        <p className="text-muted-foreground text-sm">{t("Sent.expiry")}</p>
      </AuthStepLayout>
    );
  }

  const { errors, isSubmitting } = form.formState;
  const errorLine = errors.email?.message ?? error;

  return (
    <AuthStepLayout
      title={headerT("title")}
      subtitle={headerT("description")}
      // A new link replaces the dead one, so the notice goes with it.
      notice={linkExpired && sentAt === 0 ? t("linkExpired") : undefined}
      links={
        <span>
          {t("remembered")}{" "}
          <Link
            href={signInHref}
            // The typed address travels back as a hint, as it came.
            onClick={(event) =>
              rememberAuthEmailHintOnClick(event, form.getValues("email"))
            }
            className={AUTH_STEP_LINK_CLASS}
          >
            {t("logIn")}
          </Link>
        </span>
      }
    >
      <BaseForm form={form} onSubmit={handleSubmit} className="w-full">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  {...field}
                  variant="underlined"
                  data-testid="auth-field-email"
                  type="email"
                  autoComplete="email"
                  // Phones would otherwise capitalise and autocorrect it.
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t("Fields.Email.label")}
                  aria-label={t("Fields.Email.label")}
                  // Back from "Check your email" to change the address.
                  autoFocus={cameBack}
                  aria-describedby={errorLine ? errorLineId : undefined}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <AuthStepErrorLine id={errorLineId}>{errorLine}</AuthStepErrorLine>
        <div className="mt-3 flex flex-col gap-4">
          {captcha}
          <SubmitButton
            isSubmitting={isSubmitting}
            label={t("submit")}
            className="w-full"
          />
        </div>
      </BaseForm>
    </AuthStepLayout>
  );
}
