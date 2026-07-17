import type { ErrorEvent, EventHint } from "@sentry/nextjs";

import { isExpectedChatStreamSurfaceError } from "@/lib/sentry/chat-stream-surface-errors";
import { getSentryErrorEventMessage } from "@/lib/sentry/error-event-message";
import { isExpectedClientNoiseErrorMessage } from "@/lib/sentry/expected-request-errors";
import {
  isBrowserHistoryRateLimitError,
  isInAppBrowserEnvironmentError,
  isTransientStreamClosureError,
} from "@/lib/sentry/third-party-browser-environment-errors";
import { isBrowserExtensionOnlyStackError } from "@/lib/sentry/third-party-browser-extension-errors";
import { isThirdPartyDomMutationError } from "@/lib/sentry/third-party-dom-mutation-errors";
import { isThirdPartyWalletError } from "@/lib/sentry/third-party-wallet-errors";

/** Hostnames for marketing/analytics scripts loaded via GTM or similar. */
const THIRD_PARTY_ANALYTICS_HOSTS = [
  "plausible.io",
  "px.ads.linkedin.com",
  "www.google-analytics.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
] as const;

/** Script URL substrings used by common third-party trackers (denyUrls). */
export const thirdPartyAnalyticsDenyUrls: RegExp[] = [
  /plausible\.io/i,
  /px\.ads\.linkedin\.com/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /doubleclick\.net/i,
];

/**
 * Tags injected by GTM call `window.clarity(...)` before the Clarity snippet
 * loads (or when it is blocked), throwing from gtm.js — never from our code
 * (see SOKOSUMI-CD, SOKOSUMI-6W). Message shape differs per engine:
 * Chromium/Firefox report `window.clarity is not a function`, WebKit appends
 * `. (In 'window.clarity(...)', 'window.clarity' is undefined)`.
 */
export const thirdPartyAnalyticsIgnoreErrors: RegExp[] = [
  /window\.clarity is not a function/,
];

// Sentry stores the exception type separately, so the value usually arrives
// without the `TypeError: ` prefix; accept both shapes.
const thirdPartyFetchFailurePattern =
  /^(?:TypeError: )?Failed to fetch \(([^)]+)\)$/;

/** WebKit reports blocked or offline network calls as `Load failed (hostname)`. */
const transientFetchFailurePattern =
  /^(?:TypeError: )?(?:Failed to fetch|Load failed) \(([^)]+)\)$/;

/**
 * Safari on iOS reports aborted RSC/fetch work as bare `Load failed` with no
 * hostname and no stack (SOKOSUMI-18 on `/chat`).
 */
const bareTransientNetworkFailurePattern =
  /^(?:TypeError: )?(?:Load failed|Failed to fetch)$/;

/** Consent SDK chunk load failures from Usercentrics (SOKOSUMI-7V). */
const thirdPartyDynamicImportFailurePattern =
  /Failed to fetch dynamically imported module: https?:\/\/[^/]*usercentrics/i;

/**
 * Firefox and some WebKit builds report offline or aborted fetches as a bare
 * `network error` with no hostname (SOKOSUMI-D6 on `/tasks/:taskId`).
 */
const bareNetworkErrorPattern = /^(?:TypeError: )?network error$/i;

export const bareNetworkErrorIgnoreErrors: RegExp[] = [bareNetworkErrorPattern];

/** Script URL substrings for injected extension/wallet bundles (SOKOSUMI-NB, SOKOSUMI-13, SOKOSUMI-JB). */
export const thirdPartyScriptDenyUrls: RegExp[] = [
  /hook\.js/i,
  /injected\.js/i,
  /cardano\.bundle\.js/i,
];

/** Core API hosts where client-side connectivity blips are user/network noise. */
const FIRST_PARTY_API_HOSTS = [
  "api.sokosumi.com",
  "api.preprod.sokosumi.com",
] as const;

function getEventErrorMessage(event: ErrorEvent, hint?: EventHint): string {
  return getSentryErrorEventMessage(event, hint);
}

function isKnownThirdPartyHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();

  return THIRD_PARTY_ANALYTICS_HOSTS.some((knownHost) => {
    return (
      normalizedHost === knownHost || normalizedHost.endsWith(`.${knownHost}`)
    );
  });
}

/** Chrome reports blocked third-party network calls as `Failed to fetch (hostname)`. */
export function isThirdPartyAnalyticsFetchFailure(message: string): boolean {
  const match = message.match(thirdPartyFetchFailurePattern);
  if (!match) {
    return false;
  }

  return isKnownThirdPartyHost(match[1]);
}

function isKnownFirstPartyApiHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();

  return FIRST_PARTY_API_HOSTS.some((knownHost) => {
    return (
      normalizedHost === knownHost || normalizedHost.endsWith(`.${knownHost}`)
    );
  });
}

/**
 * Mobile Safari and other WebKit engines surface offline/tab-background fetch
 * failures as `Load failed (api.sokosumi.com)` instead of Chromium's
 * `Failed to fetch (...)` (see SOKOSUMI-6H on `/signin`).
 */
export function isTransientFirstPartyApiFetchFailure(message: string): boolean {
  const match = message.match(transientFetchFailurePattern);
  if (!match) {
    return false;
  }

  return isKnownFirstPartyApiHost(match[1]);
}

export function isBareTransientNetworkFailure(message: string): boolean {
  return bareTransientNetworkFailurePattern.test(message);
}

export function isBareNetworkError(message: string): boolean {
  return bareNetworkErrorPattern.test(message);
}

export function isThirdPartyDynamicImportFailure(message: string): boolean {
  return thirdPartyDynamicImportFailurePattern.test(message);
}

export function beforeSendClientEvent(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  if (isBrowserExtensionOnlyStackError(event)) {
    return null;
  }

  const message = getEventErrorMessage(event, hint);

  if (
    isThirdPartyAnalyticsFetchFailure(message) ||
    isTransientFirstPartyApiFetchFailure(message) ||
    isBareTransientNetworkFailure(message) ||
    isBareNetworkError(message) ||
    isThirdPartyDynamicImportFailure(message) ||
    isExpectedClientNoiseErrorMessage(message) ||
    isThirdPartyDomMutationError(message) ||
    isInAppBrowserEnvironmentError(message) ||
    isBrowserHistoryRateLimitError(message) ||
    isTransientStreamClosureError(message) ||
    isExpectedChatStreamSurfaceError(event) ||
    isThirdPartyWalletError(message, event)
  ) {
    return null;
  }

  return event;
}
