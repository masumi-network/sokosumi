import { getEnv } from "@/config/env";

const NATIVE_SEO_CALLBACK_PATH = "/seo/connections/callback";

/**
 * Composio returns every sign-in to Web's callback verifier, whatever return
 * address a connect asked for. A connect that returns to another first-party
 * app (CMO) first passes through Web's hand-off page, which remembers in the
 * tab where to send the browser once the verifier is reached.
 */
export function composioHandoffUrl(input: {
  redirectUrl: string;
  returnUrl: string | undefined;
  connectionId?: string;
}): string {
  if (!input.returnUrl) return input.redirectUrl;
  // The verifier is fixed to the canonical Web host, including for previews.
  const web = getEnv().WEB_APP_BASE_URL;
  const returnAddress = new URL(input.returnUrl);
  // Native SEO redeems consent in its callback before notifying the opener.
  if (
    returnAddress.origin === new URL(web).origin &&
    returnAddress.pathname !== NATIVE_SEO_CALLBACK_PATH
  ) {
    return input.redirectUrl;
  }
  const handoff = new URL("/composio/handoff", web);
  handoff.searchParams.set("to", input.redirectUrl);
  handoff.searchParams.set("return", input.returnUrl);
  if (input.connectionId) {
    handoff.searchParams.set("connection", input.connectionId);
  }
  return handoff.toString();
}
