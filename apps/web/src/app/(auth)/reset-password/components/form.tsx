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

    toast.success(t("success"));
    // Core ended every session. A signed-in browser still holds the session
    // cookie cache, which would send sign-in into the app on a dead session.
    await signOut().catch(() => undefined);
    router.push(buildAuthPageUrl("/signin", context));
  }

  const { isSubmitting } = form.formState;

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
