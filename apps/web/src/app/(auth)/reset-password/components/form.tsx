"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm } from "@/auth/components/form/auth-form";
import { SubmitButton } from "@/auth/components/form/submit-button";
import { resetPasswordFormData } from "@/auth/reset-password/data";
import { resetPasswordWithToken } from "@/lib/actions/auth/action";
import { signOut } from "@/lib/auth/auth.client";
import { buildAuthPageUrl, readAuthPageContext } from "@/lib/auth/auth.utils";
import { CORE_AUTH_REQUEST_TIMEOUT_MS } from "@/lib/auth/core-auth-timeout";
import {
  type ResetPasswordFormSchemaType,
  resetPasswordFormSchema,
} from "@/lib/schemas/auth";

export default function ResetPasswordForm() {
  const t = useTranslations("Auth.Pages.ResetPassword.Form");
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

  const { isSubmitting } = form.formState;

  if (resetCompleted) {
    return (
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void finishSignIn();
        }}
      >
        {signOutFailed ? (
          <p role="alert" className="text-destructive text-sm">
            {t("signOutError")}
          </p>
        ) : null}
        <SubmitButton
          isSubmitting={isSigningOut}
          label={t("continueToSignIn")}
        />
      </form>
    );
  }

  return (
    <AuthForm
      form={form}
      formData={resetPasswordFormData}
      namespace="Auth.Pages.ResetPassword.Form"
      onSubmit={handleSubmit}
    >
      {failed ? (
        <p role="alert" className="text-destructive text-sm">
          {t("error")}{" "}
          <Link
            href={buildAuthPageUrl("/forgot-password", context)}
            className="font-medium underline"
          >
            {t("requestNewLink")}
          </Link>
        </p>
      ) : null}
      <SubmitButton isSubmitting={isSubmitting} label={t("submit")} />
    </AuthForm>
  );
}
