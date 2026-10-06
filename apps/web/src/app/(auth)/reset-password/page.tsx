import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthPage, AuthPageHeader } from "@/auth/components/auth-page";
import {
  type AuthRedirectSearchParams,
  buildRequestNewResetLinkUrl,
  readAuthPageContext,
  readSearchParams,
} from "@/lib/auth/auth.utils";
import { getResetPasswordToken } from "@/lib/reset-password-token-cookie";

import ResetPasswordForm from "./components/form";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.ResetPassword.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface ResetPasswordPageProps {
  searchParams: Promise<AuthRedirectSearchParams>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  // Emailed links go to `/reset-password/exchange`, which keeps the token in
  // a cookie and comes here without it.
  if (!(await getResetPasswordToken())) {
    redirect(
      buildRequestNewResetLinkUrl(
        readAuthPageContext(await readSearchParams(searchParams)),
      ),
    );
  }

  const t = await getTranslations("Auth.Pages.ResetPassword");

  return (
    <AuthPage
      header={
        <AuthPageHeader title={t("title")} description={t("description")} />
      }
      blockReplay
    >
      <ResetPasswordForm />
    </AuthPage>
  );
}
