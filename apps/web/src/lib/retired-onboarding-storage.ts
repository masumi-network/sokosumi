/**
 * Retired SOK-799 client storage. Writers are gone; expire leftovers on
 * the next request / authenticated mount.
 */
export const RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME =
  "sokosumi_subscription_onboarding_gate_sid";

export const RETIRED_SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY =
  "sokosumi.onboarding.subscription.lastLoginId";

export function expireRetiredOnboardingLocalStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(
      RETIRED_SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
    );
  } catch {
    // privacy mode / blocked storage
  }
}
