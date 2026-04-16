/**
 * HttpOnly cookie written when the subscription-only onboarding gate has been
 * served for a Better Auth session. Lets the app layout skip the onboarding
 * dialog loader on later navigations without re-fetching Stripe and org
 * billing context (localStorage alone cannot inform the server).
 */
export const SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME =
  "sokosumi_subscription_onboarding_gate_sid";

export function hasSubscriptionOnboardingGateBeenServedForSession(
  cookieSessionId: string | undefined,
  sessionId: string,
): boolean {
  return Boolean(cookieSessionId && cookieSessionId === sessionId);
}
