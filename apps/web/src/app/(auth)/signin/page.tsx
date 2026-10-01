import { resolveBetterAuthCookieName } from "@sokosumi/utils";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import OAuthHandBack from "@/auth/components/oauth-hand-back";
import SignInErrorNotice from "@/auth/components/sign-in-error-notice";
import TermsNotice from "@/auth/components/terms-notice";
import { getEnvSecrets } from "@/config/env.secrets";
import type { AuthRedirectSearchParams } from "@/lib/auth/auth.utils";
import { readOAuthRequest } from "@/lib/auth/oauth-request.server";
import { parseLastUsedAuthMethod } from "@/lib/utils/last-used-auth-method";

import SignInFlow from "./components/sign-in-flow";

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
      invitationId?: string;
      error?: string;
    }
  >;
}

export default async function SignIn({ searchParams }: SignInPageProps) {
  const env = getEnvSecrets();
  const { returnUrl, email, invitationId, error } = await searchParams;
  const oauthRequest = await readOAuthRequest(searchParams);
  if (oauthRequest?.canHandBack) {
    return (
      <OAuthHandBack
        oauthQuery={oauthRequest.query}
        client={oauthRequest.client}
        accountToConfirm={oauthRequest.accountToConfirm}
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
  const lastUsedMethod = parseLastUsedAuthMethod(
    cookieStore.get(lastUsedLoginMethodCookieName)?.value,
  );

  return (
    <SignInFlow
      client={oauthRequest?.client}
      prefilledEmail={email}
      invitationId={invitationId}
      returnUrl={returnUrl}
      lastUsedMethod={lastUsedMethod}
      notice={<SignInErrorNotice error={error} />}
    >
      <TermsNotice />
    </SignInFlow>
  );
}
