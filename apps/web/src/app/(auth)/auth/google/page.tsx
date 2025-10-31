import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import SocialSignupAutoInitiator from "@/auth/components/social-signup-auto-initiator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.SignUp.Google");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function GoogleSignupPage() {
  return <SocialSignupAutoInitiator provider="google" providerName="Google" />;
}
