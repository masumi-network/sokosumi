import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LandingRoute } from "@/types/routes";

import ResetPasswordForm from "./components/form";
import ResetPasswordHeader from "./components/header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.ResetPassword.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { token } = await searchParams;

  if (!token) {
    redirect(LandingRoute.SignIn);
  }

  return (
    <div className="flex flex-1 flex-col">
      <ResetPasswordHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <ResetPasswordForm token={token} />
      </div>
    </div>
  );
}
