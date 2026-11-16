import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  ComposioApiError,
  ComposioConfigError,
} from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { listProjectAdAccounts } from "@/services/project-ad-accounts.service";
import {
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

/**
 * Runs an ads service call. 4xx refusals happen before the provider write, or
 * as an atomic Google batch with nothing left behind, so the model may fix and
 * retry (REJECTED). 5xx and Composio failures leave the outcome unknown and
 * are never retried. Display image uploads that already wrote assets rethrow as
 * ComposioToolError so they take the unknown path too.
 */
export async function callAds<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    // 4xx: the service or Google refused the request (atomic create / one
    // change per update), so the model may fix it and retry. 5xx: outcome
    // unknown — never retry an ads write after an unclear failure.
    if (error instanceof HTTPException) {
      if (error.status >= 400 && error.status < 500)
        throw new SokoBotRefusedUnsentError(error.message);
      throw new SokoBotRuntimeValidationError(
        "The ads provider could not complete the request.",
      );
    }
    if (error instanceof ComposioConfigError)
      throw new SokoBotRefusedUnsentError(
        "Ads are not configured on this environment.",
      );
    if (error instanceof ComposioApiError || error instanceof ComposioToolError)
      throw new SokoBotRuntimeValidationError(
        "The ads provider could not complete the request.",
      );
    throw error;
  }
}

/** The campaign's page on the Ads page. */
export function adCampaignLink(
  projectId: string,
  accountId: string,
  campaignId: string,
): string {
  return `/ads/campaigns/${encodeURIComponent(campaignId)}?${new URLSearchParams({ projectId, accountId })}`;
}

/** The Project's ad account, or a refusal the model can fix with list_ad_accounts. */
export async function findAdAccount(
  projectId: string,
  accountId: string,
  workspaceId: string,
) {
  const account = (
    await callAds(() => listProjectAdAccounts({ projectId, workspaceId }))
  ).find((candidate) => candidate.id === accountId);
  if (!account)
    throw new SokoBotRefusedUnsentError(
      "Ad account not found in this Project; use an id from list_ad_accounts",
    );
  return account;
}

/** Core's Google rules, worded for the model: the first few issues. */
export function parseAdSpec<S extends z.ZodType>(schema: S, value: unknown) {
  const spec = schema.safeParse(value);
  if (!spec.success)
    throw new SokoBotRefusedUnsentError(
      spec.error.issues
        .slice(0, 3)
        .map(({ path, message }) => `${path.join(".")}: ${message}`)
        .join("; "),
    );
  return spec.data;
}
