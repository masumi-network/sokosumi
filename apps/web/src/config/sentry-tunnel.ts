/**
 * The same-origin path the browser SDK posts Sentry envelopes to, which a
 * Next.js rewrite forwards to Sentry's ingest.
 *
 * Fixed rather than Sentry's random per-build route so `proxy.ts` can let it
 * through without a session: the SDK reports whether or not the reader is
 * signed in, and a sign-in redirect turns every report into a POST to the
 * `/signin` page, which answers 405 and drops it. A plain word rather than
 * `/monitoring` from Sentry's docs, which ad-blocker lists are likelier to know.
 */
export const SENTRY_TUNNEL_PATH = "/relay";
