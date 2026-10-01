import { resolveBetterAuthCookieName } from "@sokosumi/utils";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import OAuthHandBack from "@/auth/components/oauth-hand-back";
import SignInErrorNotice from "@/auth/components/sign-in-error-notice";
import type { SignInMethodId } from "@/auth/components/social-buttons";
import TermsNotice from "@/auth/components/terms-notice";
import { getEnvSecrets } from "@/config/env.secrets";
import type { AuthRedirectSearchParams } from "@/lib/auth/auth.utils";
import { readOAuthRequest } from "@/lib/auth/oauth-request.server";
import { parseLastUsedAuthMethod } from "@/lib/utils/last-used-auth-method";

import SignUpFlow from "./components/sign-up-flow";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.SignUp.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface SignUpPageProps {
  searchParams: Promise<
    AuthRedirectSearchParams & {
      email?: string;
      invitationId?: string;
      returnUrl?: string;
      error?: string;
    }
  >;
}

export default async function SignUp({ searchParams }: SignUpPageProps) {
  const env = getEnvSecrets();
  const { email, invitationId, returnUrl, error } = await searchParams;
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
  const lastUsedAuthMethod = parseLastUsedAuthMethod(
    cookieStore.get(lastUsedLoginMethodCookieName)?.value,
  );
  const lastUsedMethod: SignInMethodId | null =
    lastUsedAuthMethod === "email" ? null : lastUsedAuthMethod;

  return (
    <SignUpFlow
      invitationId={invitationId}
      client={oauthRequest?.client}
      prefilledEmail={email}
      returnUrl={returnUrl}
      lastUsedMethod={lastUsedMethod}
      // A magic link opened in another browser cannot return to the
      // product that sent the person here.
      showMagicLink={!oauthRequest}
      notice={<SignInErrorNotice error={error} />}
    >
      <TermsNotice />
    </SignUpFlow>
  );
}
