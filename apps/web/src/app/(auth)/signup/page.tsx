import {
  getBetterAuthCookieName,
  resolveBetterAuthCookiePrefix,
} from "@sokosumi/utils";
import { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import Divider from "@/auth/components/divider";
import SocialButtons, {
  type SignInMethodId,
} from "@/auth/components/social-buttons";
import { getEnvSecrets } from "@/config/env.secrets";
import { parseLastUsedAuthMethod } from "@/lib/utils/last-used-auth-method";

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
    returnUrl?: string;
  }>;
}

export default async function SignUp({ searchParams }: SignUpPageProps) {
  const env = getEnvSecrets();
  const { email, invitationId, returnUrl } = await searchParams;
  const cookieStore = await cookies();
  const lastUsedLoginMethodCookieName = getBetterAuthCookieName(
    resolveBetterAuthCookiePrefix({
      network: env.NETWORK,
      vercelEnv: env.VERCEL_ENV,
      vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
    }),
    "last_used_login_method",
  );
  const lastUsedAuthMethod = parseLastUsedAuthMethod(
    cookieStore.get(lastUsedLoginMethodCookieName)?.value,
  );
  const lastUsedMethod: SignInMethodId | null =
    lastUsedAuthMethod === "email" ? null : lastUsedAuthMethod;

  return (
    <div className="flex flex-1 flex-col">
      <SignUpHeader invitationId={invitationId} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SocialButtons
          returnUrl={returnUrl}
          lastUsedMethod={lastUsedMethod}
          prefilledEmail={email}
          showMagicLink
        />
        <Divider labelKey="emailDivider" />
        <SignUpForm prefilledEmail={email} returnUrl={returnUrl} />
      </div>
    </div>
  );
}
