import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import SignUpForm from "./components/form";
import SignUpHeader from "./components/header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.SignUp.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface SignUpPageProps {
  searchParams: Promise<{
    email?: string;
    invitationId?: string;
  }>;
}

export default async function SignUp({ searchParams }: SignUpPageProps) {
  const { email, invitationId } = await searchParams;

  return (
    <div className="flex flex-1 flex-col">
      <SignUpHeader invitationId={invitationId} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        {/* <SocialButtons /> */}
        <SignUpForm prefilledEmail={email} invitationId={invitationId} />
      </div>
    </div>
  );
}
