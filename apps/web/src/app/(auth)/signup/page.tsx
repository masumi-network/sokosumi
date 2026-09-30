import { resolveBetterAuthCookieName } from "@sokosumi/utils";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import Divider from "@/auth/components/divider";
import OAuthHandBack from "@/auth/components/oauth-hand-back";
import SocialButtons, {
  type SignInMethodId,
} from "@/auth/components/social-buttons";
import TermsNotice from "@/auth/components/terms-notice";
import { getEnvSecrets } from "@/config/env.secrets";
import type { AuthRedirectSearchParams } from "@/lib/auth/auth.utils";
import { readOAuthRequest } from "@/lib/auth/oauth-request.server";
import { parseLastUsedAuthMethod } from "@/lib/utils/last-used-auth-method";

import SignUpForm from "./components/form";
import SignUpHeader from "./components/header";

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
    }
  >;
}

export default async function SignUp({ searchParams }: SignUpPageProps) {
  const env = getEnvSecrets();
  const { email, invitationId, returnUrl } = await searchParams;
  const oauthRequest = await readOAuthRequest(searchParams);
  if (oauthRequest?.handBack) {
    return (
      <OAuthHandBack
        oauthQuery={oauthRequest.query}
        clientName={oauthRequest.clientName}
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
    <div className="flex flex-1 flex-col">
      <SignUpHeader
        invitationId={invitationId}
        clientName={oauthRequest?.clientName}
      />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <SocialButtons
          returnUrl={returnUrl}
          lastUsedMethod={lastUsedMethod}
          prefilledEmail={email}
          // A magic link opened in another browser cannot return to the
          // product that sent the person here.
          showMagicLink={!oauthRequest}
        />
        <Divider labelKey="emailDivider" />
        <SignUpForm prefilledEmail={email} returnUrl={returnUrl} />
        <TermsNotice />
      </div>
    </div>
  );
}
