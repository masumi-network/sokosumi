import Script from "next/script";

/**
 * Google Consent Mode v2, denied by default (Basic Consent Mode). This MUST
 * run before GTM loads, so it is a `beforeInteractive` inline script placed
 * above <GoogleTagManager> in the root layout. Nothing analytics/ads-related
 * leaves the browser until the visitor opts in via the cookie banner.
 *
 * It also re-applies a previously stored choice immediately, so a returning
 * visitor's consent is honoured before the first tag can fire. The snippet is
 * mirrored on the marketing site (sokosumi-landing, templates/shell.js
 * ANALYTICS_HEAD) — keep the two in sync.
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
        var m = document.cookie.match(/(?:^|; )sokosumi_consent=([^;]+)/);
        if (m) {
          var c = JSON.parse(decodeURIComponent(m[1]));
          gtag('consent', 'update', {
            analytics_storage: c.analytics ? 'granted' : 'denied',
            ad_storage: c.marketing ? 'granted' : 'denied',
            ad_user_data: c.marketing ? 'granted' : 'denied',
            ad_personalization: c.marketing ? 'granted' : 'denied'
          });
        }
      } catch (e) {}
      gtag('set', 'url_passthrough', true);
      gtag('set', 'ads_data_redaction', true);
      `}
    </Script>
  );
}
