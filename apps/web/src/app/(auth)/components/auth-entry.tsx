import { cookies } from "next/headers";
import type { ReactNode } from "react";

import AuthFlow, { type AuthMode } from "@/auth/components/auth-flow";
import OAuthHandBack, {
  OAuthRequestError,
} from "@/auth/components/oauth-hand-back";
import SignInErrorNotice from "@/auth/components/sign-in-error-notice";
import TermsNotice from "@/auth/components/terms-notice";
import type { AuthRedirectSearchParams } from "@/lib/auth/auth.utils";
import { getLastUsedLoginMethodCookieName } from "@/lib/auth/auth-client.plugins";
import { getInvitationEmail } from "@/lib/auth/invitation-email.server";
import { readOAuthRequest } from "@/lib/auth/oauth-request.server";
import { parseLastUsedAuthMethod } from "@/lib/utils/last-used-auth-method";

export type AuthEntrySearchParams = AuthRedirectSearchParams & {
  invitationId?: string;
  error?: string;
};

/**
 * The body of Log in and Register. A Sign in with Sokosumi request goes back
 * to its product when it expired or someone is already signed in; otherwise
 * the two-step flow opens with the invitation's address and the method this
 * browser used last.
 */
export async function renderAuthEntry(
  mode: AuthMode,
  searchParams: Promise<AuthEntrySearchParams>,
): Promise<ReactNode> {
  const { invitationId, error } = await searchParams;
  const oauthRequest = await readOAuthRequest(searchParams);
  if (oauthRequest?.hasExpired) {
    return <OAuthRequestError client={oauthRequest.client} />;
  }
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
  const lastUsedMethod = parseLastUsedAuthMethod(
    cookieStore.get(getLastUsedLoginMethodCookieName())?.value,
  );

  return (
    <AuthFlow
      mode={mode}
      client={oauthRequest?.client}
      prefilledEmail={await getInvitationEmail(invitationId)}
      invitationId={invitationId}
      lastUsedMethod={lastUsedMethod}
      notice={<SignInErrorNotice error={error} />}
    >
      <TermsNotice />
    </AuthFlow>
  );
}
