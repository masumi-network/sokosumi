import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Divider from "@/auth/components/divider";
import SocialButtons from "@/auth/components/social-buttons";

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
  searchParams: Promise<{ returnUrl?: string; email?: string }>;
}

export default async function SignIn({ searchParams }: SignInPageProps) {
  const { returnUrl, email } = await searchParams;

  return (
    <div className="flex flex-1 flex-col">
      <SignInHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SocialButtons />
        <Divider />
        <SignInForm returnUrl={returnUrl} prefilledEmail={email} />
      </div>
    </div>
  );
}
