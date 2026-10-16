"use server";

import {
  type FinalizeProjectAdConnectionResponse,
  type GoogleLocation,
  type InitiateProjectSocialConnectionResponse,
  type ProjectAdAccount,
  ProjectAdProvider,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { loadGoogleSetup } from "@/app/ads/campaigns/google-setup";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  AD_CAMPAIGN_NAME_MAX_LENGTH,
  AD_CAMPAIGN_OBJECTIVES,
} from "@/lib/ads/campaign";
import {
  googleDisplayEditSpecSchema,
  googleDisplaySpecSchema,
} from "@/lib/ads/google-display";
import { googleSearchSpecSchema } from "@/lib/ads/google-search";
import { createMarketProfileSchema } from "@/lib/ads/market";
import { GOOGLE_LOCATION_QUERY_MAX_LENGTH } from "@/lib/ads/targeting";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import { adsService } from "@/lib/services/ads.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const trimmedId = z.string().trim().min(1);

/** What a campaign is created or edited with. */
const campaignName = z.string().trim().min(1).max(AD_CAMPAIGN_NAME_MAX_LENGTH);
const campaignBudget = z.number().positive();

/**
 * An ads action: input validated against `schema`, then `run` against Core.
 * Core's errors keep their `kind` (for example "integration_not_configured"),
 * which is what the UI branches on, and so does their HTTP `status`.
 */
function adsAction<S extends z.ZodType, T>(
  schema: S,
  run: (input: z.output<S>) => Promise<T>,
) {
  return withSession<
    z.input<S> & AuthenticatedRequest,
    ActionResultDto<T, ActionError>
  >(async (params) => {
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: parsed.error.issues[0]?.message ?? "Invalid ad input",
        }),
      );
    }

    try {
      return toActionResult(ok(await run(parsed.data)));
    } catch (error) {
      return toActionResult(
        err({
          ...toCoreApiActionError(error),
          ...(error instanceof CoreApiRequestError && error.status
            ? { status: error.status }
            : {}),
        }),
      );
    }
  });
}

export const initiateAdConnection = adsAction(
  z.object({
    projectId: trimmedId,
    provider: z.enum(ProjectAdProvider),
  }),
  async ({
    projectId,
    provider,
  }): Promise<InitiateProjectSocialConnectionResponse> =>
    adsService.initiateConnection(projectId, provider),
);

export const finalizeAdConnection = adsAction(
  z.object({ projectId: trimmedId, connectionId: trimmedId }),
  async ({
    projectId,
    connectionId,
  }): Promise<FinalizeProjectAdConnectionResponse> =>
    adsService.finalizeConnection(projectId, connectionId),
);

export const attachAdAccounts = adsAction(
  z.object({
    projectId: trimmedId,
    adConnectionId: trimmedId,
    externalAccountIds: z.array(trimmedId).min(1),
  }),
  async ({
    projectId,
    adConnectionId,
    externalAccountIds,
  }): Promise<ProjectAdAccount[]> => {
    const accounts = await adsService.attachAccounts(
      projectId,
      adConnectionId,
      externalAccountIds,
    );
    revalidatePath("/ads");
    return accounts;
  },
);

export const disconnectAdAccount = adsAction(
  z.object({ projectId: trimmedId, accountId: trimmedId }),
  async ({ projectId, accountId }) => {
    await adsService.disconnectAccount(projectId, accountId);
    revalidatePath("/ads");
  },
);

/** Drops a finalized connection nobody attached accounts to. */
export const discardAdConnection = adsAction(
  z.object({ projectId: trimmedId, adConnectionId: trimmedId }),
  async ({ projectId, adConnectionId }) => {
    await adsService.discardConnection(projectId, adConnectionId);
  },
);

/** Pauses or resumes a campaign, or changes its daily budget (the list and the menu). */
export const updateAdCampaign = adsAction(
  z
    .object({
      projectId: trimmedId,
      accountId: trimmedId,
      campaignId: trimmedId,
      status: z.enum(["ACTIVE", "PAUSED"]).optional(),
      dailyBudget: z.number().positive().optional(),
    })
    .refine(
      ({ status, dailyBudget }) =>
        status !== undefined || dailyBudget !== undefined,
      { message: "Nothing to update" },
    ),
  async ({ projectId, accountId, campaignId, status, dailyBudget }) => {
    await adsService.updateCampaign(projectId, accountId, campaignId, {
      ...(status ? { status } : {}),
      ...(dailyBudget !== undefined ? { dailyBudget } : {}),
    });
    revalidatePath("/ads");
    revalidatePath(`/ads/campaigns/${campaignId}`);
  },
);

/**
 * Creates a campaign. Core always creates it paused. A Google campaign carries
 * its `google` spec and no objective; a Meta one the reverse. Core refuses a
 * mismatch with 422, and so does Google for what it dislikes: the message
 * reaches the UI.
 */
export const createAdCampaign = adsAction(
  z.object({
    projectId: trimmedId,
    accountId: trimmedId,
    name: campaignName,
    dailyBudget: campaignBudget,
    objective: z.enum(AD_CAMPAIGN_OBJECTIVES).optional(),
    google: z
      .discriminatedUnion("type", [
        googleSearchSpecSchema(),
        googleDisplaySpecSchema(),
      ])
      .optional(),
  }),
  async ({ projectId, accountId, name, dailyBudget, objective, google }) => {
    const campaign = await adsService.createCampaign(projectId, accountId, {
      name,
      dailyBudget,
      ...(objective ? { objective } : {}),
      ...(google ? { google } : {}),
    });
    revalidatePath("/ads");
    return campaign;
  },
);

/**
 * Edits all of a Google campaign's settings (the edit page; `updateAdCampaign`
 * only pauses, resumes or changes the budget). The spec is the create one,
 * except that Display images may also be kept ones. Core answers 204 (also
 * when nothing changed), and 422 with Google's own message for what it
 * dislikes, which reaches the UI.
 */
export const editAdCampaign = adsAction(
  z.object({
    projectId: trimmedId,
    accountId: trimmedId,
    campaignId: trimmedId,
    name: campaignName,
    dailyBudget: campaignBudget,
    google: z.discriminatedUnion("type", [
      googleSearchSpecSchema(),
      googleDisplayEditSpecSchema(),
    ]),
  }),
  async ({ projectId, accountId, campaignId, name, dailyBudget, google }) => {
    await adsService.editCampaign(projectId, accountId, campaignId, {
      name,
      dailyBudget,
      google,
    });
    revalidatePath("/ads");
    revalidatePath(`/ads/campaigns/${campaignId}`);
  },
);

/**
 * The names of the project's trending Market keywords, for "Add from Market".
 * Core serves them from its 24-hour cache and asks the data provider (which
 * is paid) only when that has run out, so this is called on a click, never on
 * page load.
 */
export const listAdMarketKeywords = adsAction(
  z.object({ projectId: trimmedId }),
  async ({ projectId }): Promise<string[]> => {
    const { keywords } = await adsService.listMarketKeywords(projectId);
    return keywords.map(({ keyword }) => keyword);
  },
);

/**
 * What the new-campaign wizard needs before it shows a Google form: whether
 * there is a Market profile, Google's languages and the profile's suggested
 * targeting. A failed part hides only itself (see `loadGoogleSetup`).
 */
export const getGoogleCampaignSetup = adsAction(
  z.object({ projectId: trimmedId, accountId: trimmedId }),
  ({ projectId, accountId }) => loadGoogleSetup(projectId, accountId),
);

/**
 * Google locations matching what the reader typed, for the location picker.
 * Core refuses an account that is not a Google one with 404.
 */
export const searchAdLocations = adsAction(
  z.object({
    projectId: trimmedId,
    accountId: trimmedId,
    q: z.string().trim().min(1).max(GOOGLE_LOCATION_QUERY_MAX_LENGTH),
  }),
  async ({ projectId, accountId, q }): Promise<GoogleLocation[]> => {
    const { locations } = await adsService.searchLocations(
      projectId,
      accountId,
      q,
    );
    return locations;
  },
);

/** Saves the market profile Core reads trending keywords and ads for. */
export const saveAdsMarketProfile = adsAction(
  createMarketProfileSchema().extend({ projectId: trimmedId }),
  async ({ projectId, ...profile }) => {
    const saved = await adsService.saveMarketProfile(projectId, profile);
    revalidatePath("/ads");
    return saved;
  },
);
