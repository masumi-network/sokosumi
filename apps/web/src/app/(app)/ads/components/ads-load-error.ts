import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { err, ok, type Result } from "neverthrow";

import { CoreApiRequestError } from "@/lib/clients/core.client";

/** Not set up on this deployment yet, or a failure worth trying again. */
export type AdsLoadError = "unavailable" | "failed";

/** What the Campaigns tab and a campaign's details show: a lost connection, or a shared error. */
export type CampaignsLoadError = "not_active" | AdsLoadError;

/** What a section loaded: its data, or the error to show in its place. */
export type AdsLoad<T> = Result<T, AdsLoadError>;

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

/** 409 means the connection is no longer active; the rest is shared. */
export function toCampaignsLoadError(
  error: CoreApiRequestError,
): CampaignsLoadError {
  return error.status === 409 ? "not_active" : toAdsLoadError(error);
}

/** Waits for a load, turning a Core failure into the error to show. */
export async function settleAdsLoad<T>(load: Promise<T>): Promise<AdsLoad<T>> {
  try {
    return ok(await load);
  } catch (error) {
    return err(toAdsLoadError(error));
  }
}
