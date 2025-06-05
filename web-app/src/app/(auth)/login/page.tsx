import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import SignInForm from "./components/form";
import SignInHeader from "./components/header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.SignIn.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface SignInPageProps {
  searchParams: Promise<{ returnUrl?: string }>;
}

export default async function SignIn({ searchParams }: SignInPageProps) {
  const { returnUrl } = await searchParams;

  return (
    <div className="flex flex-1 flex-col">
      <SignInHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        {/* <SocialButtons /> */}
        <SignInForm returnUrl={returnUrl} />
      </div>
    </div>
  );
}
