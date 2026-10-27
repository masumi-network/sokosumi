import * as Sentry from "@sentry/nextjs";
import { getEnvPublicConfig } from "@/config/env.public";
import { ablyAuthSessionIgnoreErrors } from "@/lib/sentry/ably-auth-session-errors";
import { ablyChannelLifecycleIgnoreErrors } from "@/lib/sentry/ably-channel-lifecycle-errors";
import { webSentryDataCollection } from "@/lib/sentry/data-collection";
import { expectedClientNoiseIgnoreErrors } from "@/lib/sentry/expected-request-errors";
import { redactResetPasswordToken } from "@/lib/sentry/reset-password-token-redaction";
import {
  browserHistoryRateLimitIgnoreErrors,
  firefoxBridgeIgnoreErrors,
  inAppBrowserIgnoreErrors,
  transientStreamIgnoreErrors,
} from "@/lib/sentry/third-party-browser-environment-errors";
import { thirdPartyDomMutationIgnoreErrors } from "@/lib/sentry/third-party-dom-mutation-errors";
import {
  bareNetworkErrorIgnoreErrors,
  beforeSendClientEvent,
  thirdPartyAnalyticsDenyUrls,
  thirdPartyAnalyticsIgnoreErrors,
  thirdPartyScriptDenyUrls,
} from "@/lib/sentry/third-party-fetch-errors";
import { thirdPartyWalletIgnoreErrors } from "@/lib/sentry/third-party-wallet-errors";

Sentry.init({
  dsn: getEnvPublicConfig().NEXT_PUBLIC_SENTRY_DSN,
  dataCollection: webSentryDataCollection,
  enhanceFetchErrorMessages: "report-only",

  denyUrls: [...thirdPartyAnalyticsDenyUrls, ...thirdPartyScriptDenyUrls],
  ignoreErrors: [
    ...thirdPartyDomMutationIgnoreErrors,
    ...thirdPartyAnalyticsIgnoreErrors,
    ...thirdPartyWalletIgnoreErrors,
    ...inAppBrowserIgnoreErrors,
    ...firefoxBridgeIgnoreErrors,
    ...browserHistoryRateLimitIgnoreErrors,
    ...transientStreamIgnoreErrors,
    ...bareNetworkErrorIgnoreErrors,
    ...ablyChannelLifecycleIgnoreErrors,
    ...ablyAuthSessionIgnoreErrors,
    ...expectedClientNoiseIgnoreErrors,
  ],
  beforeSend: beforeSendClientEvent,
  beforeSendSpan: redactResetPasswordToken,

  integrations: [Sentry.replayIntegration({})],

  tracesSampleRate: 0.005,

  replaysSessionSampleRate: 0.005,

  replaysOnErrorSampleRate: 1.0,

  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
