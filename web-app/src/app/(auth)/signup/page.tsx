import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import SocialButtons from "../components/social-buttons";
import SignUpForm from "./components/form";
import SignUpHeader from "./components/header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.SignUp.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function SignUp() {
  return (
    <div className="flex flex-1 flex-col">
      <SignUpHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SocialButtons variant="signup" />
        <SignUpForm />
      </div>
    </div>
  );
}
