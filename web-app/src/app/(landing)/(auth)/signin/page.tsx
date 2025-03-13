import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import SocialButtons from "../components/social-buttons";
import SignInForm from "./components/form";
import SignInHeader from "./components/header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.SignIn.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function SignIn() {
  return (
    <div className="flex flex-1 flex-col">
      <SignInHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SocialButtons variant="signin" />
        <SignInForm />
      </div>
    </div>
  );
}
