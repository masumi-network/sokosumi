import Script from "next/script";

import { CONSENT_COOKIE, CONSENT_VERSION } from "@/lib/analytics/consent";

/**
 * Google Consent Mode v2, denied by default (Advanced: tags still load).
 * MUST run before GTM, so this is a `beforeInteractive` inline script above
 * <GoogleTagManager> in the root layout. Storage signals stay denied until
 * the banner grants them; cookieless pings can still leave. Does not gate
 * Vercel Analytics / Speed Insights. See apps/web/TRACKING.md.
 *
 * Re-applies a stored choice immediately so a returning visitor's consent is
 * honoured before the first tag can fire. Mirrored on the marketing site
 * (sokosumi-landing, templates/shell.js ANALYTICS_HEAD) — keep both in sync.
 */
export function ConsentModeInit() {
  return (
    <Script id="sokosumi-consent-default" strategy="beforeInteractive">
      {`
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('consent', 'default', {
        ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
        analytics_storage: 'denied', functionality_storage: 'granted',
        security_storage: 'granted', wait_for_update: 500
      });
      try {
        var m = document.cookie.match(new RegExp('(?:^|; )' + ${JSON.stringify(CONSENT_COOKIE)} + '=([^;]+)'));
        if (m) {
          var c = JSON.parse(decodeURIComponent(m[1]));
          // Mirror readConsent(): a cookie written against an older schema is
          // not a decision about the current categories, and a hand-crafted one
          // must not grant anything. Without this the inline path honoured a
          // stale or forged cookie that the TypeScript reader rejects.
          if (c && c.v === ${CONSENT_VERSION} && typeof c.analytics === 'boolean' && typeof c.marketing === 'boolean') {
          gtag('consent', 'update', {
            analytics_storage: c.analytics ? 'granted' : 'denied',
            ad_storage: c.marketing ? 'granted' : 'denied',
            ad_user_data: c.marketing ? 'granted' : 'denied',
            ad_personalization: c.marketing ? 'granted' : 'denied'
          });
          // The GTM container gates every conversion tag behind a
          // \`consent_status\` event (trigger groups). The banner only fires it
          // when someone clicks, and a returning visitor never sees the banner
          // — so without this push their tags would never fire again after the
          // visit where they first accepted.
          window.dataLayer.push({
            event: 'consent_status',
            consent_analytics: c.analytics ? 'granted' : 'denied',
            consent_marketing: c.marketing ? 'granted' : 'denied'
          });
          }
        }
      } catch (e) {}
      gtag('set', 'url_passthrough', true);
      gtag('set', 'ads_data_redaction', true);
      `}
    </Script>
  );
}
