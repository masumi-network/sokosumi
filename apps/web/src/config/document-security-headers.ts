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
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy
 */
export const CROSS_ORIGIN_OPENER_POLICY = "same-origin-allow-popups";

export interface DocumentSecurityHeader {
  key: string;
  value: string;
}

interface DocumentSecurityHeaderOptions {
  /**
   * HSTS is only correct where the app is served over https. Local dev and
   * `pnpm portless` serve plain http, so the caller decides.
   */
  includeHsts: boolean;
}

/**
 * The document security headers, in one list.
 *
 * Applied from both `next.config.ts` (rendered documents and API routes) and
 * `proxy.ts` (redirects and error responses the proxy builds itself, which
 * never reach the Next.js header layer). A visitor's first response is often a
 * proxy redirect, so a header set only in `next.config.ts` misses the hop that
 * matters most for HSTS.
 */
export function documentSecurityHeaders(
  options: DocumentSecurityHeaderOptions,
): DocumentSecurityHeader[] {
  return [
    { key: "Cross-Origin-Opener-Policy", value: CROSS_ORIGIN_OPENER_POLICY },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Denies only the capabilities the product never uses; every unlisted
    // feature keeps its browser default, so same-origin clipboard writes and
    // notifications keep working.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    // DENY, not SAMEORIGIN: nothing embeds the app. The iframes in
    // offer-card, document-viewer and image-viewer are outbound (third-party
    // documents) or `about:blank`, so none of them load an app document.
    { key: "X-Frame-Options", value: "DENY" },
    // No `preload`: combined with `includeSubDomains` a preload submission is
    // very hard to reverse.
    ...(options.includeHsts
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]
      : []),
  ];
}

export function applyDocumentSecurityHeaders(
  response: NextResponse,
  options: DocumentSecurityHeaderOptions,
): void {
  for (const { key, value } of documentSecurityHeaders(options)) {
    response.headers.set(key, value);
  }
}
