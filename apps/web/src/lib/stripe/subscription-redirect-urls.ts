/**
 * Query param that carries the Stripe Checkout session id back from a
 * subscription checkout. Distinct from the credits flow's `session_id` so a
 * subscription return never opens the credits success modal.
 */
export const SUBSCRIPTION_CHECKOUT_SESSION_PARAM = "checkout_session_id";

const STRIPE_CHECKOUT_SESSION_ID_PLACEHOLDER = "{CHECKOUT_SESSION_ID}";

export function buildSubscriptionStatusPath(
  returnPath: string,
  status: "cancel" | "success",
): string {
  const [pathname, queryString = ""] = returnPath.split("?");
  const searchParams = new URLSearchParams(queryString);
  searchParams.set("status", status);

  const nextQueryString = searchParams.toString();
  if (!nextQueryString) {
    return pathname;
  }

  return `${pathname}?${nextQueryString}`;
}

/**
 * Appends Stripe's `{CHECKOUT_SESSION_ID}` template to an absolute success URL.
 *
 * The braces must stay literal: Better Auth's Stripe plugin wraps this URL as
 * `callbackURL` on its own `/subscription/success` hop and substitutes the
 * placeholder there with `replaceAll("{CHECKOUT_SESSION_ID}", …)`. Building it
 * with `URLSearchParams` would encode the braces and the substitution would
 * silently never match.
 */
export function withCheckoutSessionIdPlaceholder(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${SUBSCRIPTION_CHECKOUT_SESSION_PARAM}=${STRIPE_CHECKOUT_SESSION_ID_PLACEHOLDER}`;
}

/**
 * True for a real Stripe Checkout session id. Better Auth redirects to the
 * callback without substituting the placeholder on some early exits (no
 * session cookie), so the raw template can reach the page.
 */
export function isStripeCheckoutSessionId(
  value: string | undefined,
): value is string {
  return typeof value === "string" && /^cs_[A-Za-z0-9_]+$/.test(value);
}
