import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthPage, AuthPageHeader } from "@/auth/components/auth-page";
import {
  type AuthRedirectSearchParams,
  appendQueryParam,
  buildAuthPageUrl,
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
  searchParams: Promise<AuthRedirectSearchParams & { token?: string }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const query = await readSearchParams(searchParams);
  const token = query.get("token");
  query.delete("token");
  const context = readAuthPageContext(query);

  if (token) {
    redirect(
      appendQueryParam(
        buildAuthPageUrl("/reset-password/exchange", context),
        "token",
        token,
      ),
    );
  }

  if (!(await getResetPasswordToken())) {
    redirect(buildRequestNewResetLinkUrl(context));
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
