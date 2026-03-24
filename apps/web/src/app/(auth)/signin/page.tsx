import {
  getBetterAuthCookieName,
  resolveBetterAuthCookiePrefix,
} from "@sokosumi/utils";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import Divider from "@/auth/components/divider";
import SocialButtons, {
  type SignInMethodId,
} from "@/auth/components/social-buttons";
import { getBetterAuthPublicBaseUrl } from "@/config/better-auth-public-url";
import { getEnvSecrets } from "@/config/env.secrets";
import { parseLastUsedAuthMethod } from "@/lib/utils/last-used-auth-method";

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
  const env = getEnvSecrets();
  const { returnUrl, email } = await searchParams;
  const cookieStore = await cookies();
  const lastUsedLoginMethodCookieName = getBetterAuthCookieName(
    resolveBetterAuthCookiePrefix({
      baseUrl: getBetterAuthPublicBaseUrl(),
      vercelBranchUrl: env.VERCEL_BRANCH_URL,
    }),
    "last_used_login_method",
  );
  const lastUsedLoginMethod = parseLastUsedAuthMethod(
    cookieStore.get(lastUsedLoginMethodCookieName)?.value,
  );
  const lastUsedMethod: SignInMethodId | null =
    lastUsedLoginMethod === "email" ? null : lastUsedLoginMethod;
  const isLastUsedEmailLogin = lastUsedLoginMethod === "email";

  return (
    <div className="flex flex-1 flex-col">
      <SignInHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SocialButtons
          returnUrl={returnUrl}
          lastUsedMethod={lastUsedMethod}
          prefilledEmail={email}
          showMagicLink
          showPasskey
        />
        <Divider labelKey="passwordDivider" />
        <SignInForm
          returnUrl={returnUrl}
          prefilledEmail={email}
          isLastUsedEmailLogin={isLastUsedEmailLogin}
        />
      </div>
    </div>
  );
}
