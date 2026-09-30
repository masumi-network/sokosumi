import { resolveBetterAuthCookieName } from "@sokosumi/utils";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import Divider from "@/auth/components/divider";
import OAuthHandBack from "@/auth/components/oauth-hand-back";
import SignInErrorNotice from "@/auth/components/sign-in-error-notice";
import SocialButtons, {
  type SignInMethodId,
} from "@/auth/components/social-buttons";
import TermsNotice from "@/auth/components/terms-notice";
import { getEnvSecrets } from "@/config/env.secrets";
import type { AuthRedirectSearchParams } from "@/lib/auth/auth.utils";
import { readOAuthRequest } from "@/lib/auth/oauth-request.server";
import { parseLastUsedAuthMethod } from "@/lib/utils/last-used-auth-method";

import SignInForm from "./components/form";
import SignInHeader from "./components/header";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.SignIn.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface SignInPageProps {
  searchParams: Promise<
    AuthRedirectSearchParams & {
      returnUrl?: string;
      email?: string;
      error?: string;
    }
  >;
}

export default async function SignIn({ searchParams }: SignInPageProps) {
  const env = getEnvSecrets();
  const { returnUrl, email, error } = await searchParams;
  const oauthRequest = await readOAuthRequest(searchParams);
  if (oauthRequest?.canHandBack) {
    return (
      <OAuthHandBack
        oauthQuery={oauthRequest.query}
        client={oauthRequest.client}
      />
    );
  }
  const cookieStore = await cookies();
  const lastUsedLoginMethodCookieName = resolveBetterAuthCookieName(
    {
      network: env.NETWORK,
      vercelEnv: env.VERCEL_ENV,
      vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
    },
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
      <SignInHeader client={oauthRequest?.client} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SignInErrorNotice error={error} />
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
        <TermsNotice />
      </div>
    </div>
  );
}
