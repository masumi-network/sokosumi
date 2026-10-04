"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  AUTH_STEP_LINK_CLASS,
  AuthStepErrorLine,
  AuthStepLayout,
} from "@/auth/components/auth-step-layout";
import { BaseForm } from "@/auth/components/form/base-form";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { PasswordInput } from "@/components/auth/password-input";
import { FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { resetPasswordWithToken } from "@/lib/actions/auth/action";
import { signOut } from "@/lib/auth/auth.client";
import { buildAuthPageUrl, readAuthPageContext } from "@/lib/auth/auth.utils";
import { CORE_AUTH_REQUEST_TIMEOUT_MS } from "@/lib/auth/core-auth-timeout";
import {
  type ResetPasswordFormSchemaType,
  resetPasswordFormSchema,
} from "@/lib/schemas/auth";
import { cn } from "@/lib/utils";

/**
 * Sets the new password from the emailed link, then signs this browser out
 * and returns to Log in. Every refusal shows in one line above the button.
 */
export default function ResetPasswordForm() {
  const pageT = useTranslations("Auth.Pages.ResetPassword");
  const t = useTranslations("Auth.Pages.ResetPassword.Form");
  const errorLineId = useId();
  const router = useRouter();
  // The sign-in the reset started from, carried through the emailed link.
  const context = readAuthPageContext(useSearchParams());
  const [failed, setFailed] = useState(false);
  const [resetCompleted, setResetCompleted] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const form = useForm<ResetPasswordFormSchemaType>({
    resolver: zodResolver(
      resetPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  async function handleSubmit(values: ResetPasswordFormSchemaType) {
    setFailed(false);
    const resetPasswordResult = await resetPasswordWithToken(values);

    if (!resetPasswordResult.ok) {
      setFailed(true);
      return;
    }

    setResetCompleted(true);
    await finishSignIn();
  }

  async function finishSignIn() {
    setIsSigningOut(true);
    setSignOutFailed(false);
    try {
      // Core revoked the sessions, but only a successful sign-out clears this
      // browser's cookie cache. Retry this step without reusing the reset token.
      const result = await signOut({
        fetchOptions: {
          timeout: CORE_AUTH_REQUEST_TIMEOUT_MS,
          plugins: [
            {
              id: "password-reset-sign-out",
              name: "Password reset sign-out",
              hooks: {
                onRequest(request) {
                  // Runs after the OAuth client plugin. Logout must not depend
                  // on the request that may have expired during the email trip.
                  request.body = JSON.stringify({});
                },
              },
            },
          ],
        },
      });
      if (result.error) {
        setSignOutFailed(true);
        return;
      }
      toast.success(t("success"));
      router.push(buildAuthPageUrl("/signin", context));
    } catch {
      setSignOutFailed(true);
    } finally {
      setIsSigningOut(false);
    }
  }

  const { errors, isSubmitting } = form.formState;
  // The first refused field, in the order they appear.
  const lineField = (["password", "confirmPassword"] as const).find(
    (name) => errors[name],
  );
  const errorLine = lineField ? (
    errors[lineField]?.message
  ) : failed ? (
    <>
      {t("error")}{" "}
      <Link
        href={buildAuthPageUrl("/forgot-password", context)}
        className={cn(
          AUTH_STEP_LINK_CLASS,
          "whitespace-nowrap text-current hover:text-current",
        )}
      >
        {t("requestNewLink")}
      </Link>
    </>
  ) : null;

  return (
    <AuthStepLayout
      title={pageT("title")}
      subtitle={pageT("description")}
      // Once the password changed, only the sign-out leads on: this
      // browser's cookie cache still holds the session Core revoked.
      links={
        resetCompleted ? undefined : (
          <Link
            href={buildAuthPageUrl("/signin", context)}
            className={AUTH_STEP_LINK_CLASS}
          >
            {t("backToLogIn")}
          </Link>
        )
      }
    >
      {resetCompleted ? (
        <form
          className="flex w-full flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void finishSignIn();
          }}
        >
          <AuthStepErrorLine id={errorLineId}>
            {signOutFailed ? t("signOutError") : null}
          </AuthStepErrorLine>
          <SubmitButton
            isSubmitting={isSigningOut}
            label={t("continueToSignIn")}
            className="w-full"
          />
        </form>
      ) : (
        <BaseForm form={form} onSubmit={handleSubmit} className="w-full">
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
                    aria-describedby={
                      lineField === "password" ? errorLineId : undefined
                    }
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    {...field}
                    variant="underlined"
                    type="password"
                    data-testid="auth-field-confirmPassword"
                    autoComplete="new-password"
                    placeholder={t("Fields.ConfirmPassword.label")}
                    aria-label={t("Fields.ConfirmPassword.label")}
                    aria-describedby={
                      lineField === "confirmPassword" ? errorLineId : undefined
                    }
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <AuthStepErrorLine id={errorLineId}>{errorLine}</AuthStepErrorLine>
          <SubmitButton
            isSubmitting={isSubmitting}
            label={t("submit")}
            className="mt-3 w-full"
          />
        </BaseForm>
      )}
    </AuthStepLayout>
  );
}
