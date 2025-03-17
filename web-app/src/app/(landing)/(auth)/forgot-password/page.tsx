import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import ForgotPasswordForm from "./components/form";
import ForgotPasswordHeader from "./components/header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.ForgotPassword.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function ForgotPassword() {
  return (
    <div className="flex flex-1 flex-col">
      <ForgotPasswordHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
