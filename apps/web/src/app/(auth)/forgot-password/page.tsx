import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AuthPage, AuthPageHeader } from "@/auth/components/auth-page";
import { INVALID_RESET_LINK_ERROR } from "@/lib/auth/auth.utils";

import ForgotPasswordForm from "./components/form";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.ForgotPassword.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface ForgotPasswordPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function ForgotPassword({
  searchParams,
}: ForgotPasswordPageProps) {
  const { error } = await searchParams;
  const t = await getTranslations("Auth.Pages.ForgotPassword.Header");

  return (
    <AuthPage
      header={
        <AuthPageHeader title={t("title")} description={t("description")} />
      }
    >
      <ForgotPasswordForm linkExpired={error === INVALID_RESET_LINK_ERROR} />
    </AuthPage>
  );
}
