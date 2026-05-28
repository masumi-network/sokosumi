import type { BrowserOptions, ErrorEvent } from "@sentry/nextjs";

import {
  shouldDropThirdPartyClientError,
  thirdPartyClientDenyUrls,
  thirdPartyClientIgnoreErrors,
} from "@/lib/sentry/third-party-error-filter";

export function beforeSendClientEvent(event: ErrorEvent): ErrorEvent | null {
  if (shouldDropThirdPartyClientError(event)) {
    return null;
  }
  return event;
}

export function getClientSentryOptions(): Pick<
  BrowserOptions,
  "beforeSend" | "denyUrls" | "ignoreErrors"
> {
  return {
    beforeSend: beforeSendClientEvent,
    denyUrls: thirdPartyClientDenyUrls,
    ignoreErrors: thirdPartyClientIgnoreErrors,
  };
}
