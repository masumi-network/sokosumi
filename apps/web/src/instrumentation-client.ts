import * as Sentry from "@sentry/nextjs";
import { ablyAuthSessionIgnoreErrors } from "@/lib/sentry/ably-auth-session-errors";
import { ablyChannelLifecycleIgnoreErrors } from "@/lib/sentry/ably-channel-lifecycle-errors";
import { expectedClientNoiseIgnoreErrors } from "@/lib/sentry/expected-request-errors";
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
  // eslint-disable-next-line no-restricted-properties
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

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

  integrations: [Sentry.replayIntegration({})],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 0.005,

  replaysSessionSampleRate: 0.005,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});

// This export will instrument router navigations, and is only relevant if you enable tracing.
// `captureRouterTransitionStart` is available from SDK version 9.12.0 onwards
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
