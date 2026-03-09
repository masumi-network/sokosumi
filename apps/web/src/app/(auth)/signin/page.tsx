import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import Divider from "@/auth/components/divider";
import SocialButtons, {
  type SocialButtonProviderId,
} from "@/auth/components/social-buttons";

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

type LastUsedLoginMethod = SocialButtonProviderId | "email";

function parseLastUsedLoginMethod(value?: string): LastUsedLoginMethod | null {
  if (value === "google" || value === "microsoft" || value === "email") {
    return value;
  }

  return null;
}

export default async function SignIn({ searchParams }: SignInPageProps) {
  const { returnUrl, email } = await searchParams;
  const cookieStore = await cookies();
  const lastUsedLoginMethod = parseLastUsedLoginMethod(
    cookieStore.get("better-auth.last_used_login_method")?.value,
  );
  const lastUsedSocialProvider: SocialButtonProviderId | null =
    lastUsedLoginMethod === "email" ? null : lastUsedLoginMethod;
  const isLastUsedEmailLogin = lastUsedLoginMethod === "email";

  return (
    <div className="flex flex-1 flex-col">
      <SignInHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SocialButtons
          returnUrl={returnUrl}
          lastUsedSocialProvider={lastUsedSocialProvider}
        />
        <Divider />
        <SignInForm
          returnUrl={returnUrl}
          prefilledEmail={email}
          isLastUsedEmailLogin={isLastUsedEmailLogin}
        />
      </div>
    </div>
  );
}
