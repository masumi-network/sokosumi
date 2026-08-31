import type { NextResponse } from "next/server";

/**
 * `same-origin` (Next.js / hosting default in some setups) breaks OAuth
 * popups: once the popup navigates to a third-party IdP, COOP puts it in a
 * separate browsing context group, so the opener cannot read `popup.closed`
 * and `window.opener` may be null on the callback page.
 *
 * `same-origin-allow-popups` is the recommended opener policy for OAuth: it
 * keeps isolation for untrusted popups while allowing `Window.open()` targets
 * with `unsafe-none` (typical for IdPs). It does **not** keep a live opener
 * reference through a cross-origin redirect — use BroadcastChannel for
 * callback delivery.
 *
 * Applied from both `proxy.ts` and `next.config.ts` so the header is always set
 * on document responses.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy
 */
export const CROSS_ORIGIN_OPENER_POLICY = "same-origin-allow-popups";

export function applyDocumentSecurityHeaders(response: NextResponse): void {
  response.headers.set(
    "Cross-Origin-Opener-Policy",
    CROSS_ORIGIN_OPENER_POLICY,
  );
}
