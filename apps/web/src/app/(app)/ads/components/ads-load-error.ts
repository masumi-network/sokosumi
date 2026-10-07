import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { CoreApiRequestError } from "@/lib/clients/core.client";

/** Not set up on this deployment yet, or a failure worth trying again. */
export type AdsLoadError = "unavailable" | "failed";

/** What a section loaded: its data, or the error to show in its place. */
export type AdsLoad<T> =
  | { data: T; error?: undefined }
  | { data?: undefined; error: AdsLoadError };

/**
 * What a failed Ads load shows, by Core's error kind (a provider that is not
 * set up) and not by its status. Anything that is not a Core failure, such as a
 * lost session, still reaches the route's error boundary.
 */
export function toAdsLoadError(error: unknown): AdsLoadError {
  if (!(error instanceof CoreApiRequestError)) throw error;
  return error.kind === CORE_API_ERROR_KINDS.INTEGRATION_NOT_CONFIGURED
    ? "unavailable"
    : "failed";
}

/** Waits for a load, turning a Core failure into the error to show. */
export async function settleAdsLoad<T>(load: Promise<T>): Promise<AdsLoad<T>> {
  try {
    return { data: await load };
  } catch (error) {
    return { error: toAdsLoadError(error) };
  }
}
