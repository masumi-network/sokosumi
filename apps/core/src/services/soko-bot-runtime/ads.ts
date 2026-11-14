import {
  getSokoBotVersion,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { sokoBotProjectRefusal } from "@/lib/soko-bot/write-scope";
import {
  googleCampaignEditSpecSchema,
  googleCampaignSpecSchema,
} from "@/schemas/project-ad-account.schema";
import {
  createProjectAdCampaign,
  deleteProjectAdCampaign,
  editProjectAdCampaign,
  getProjectAdCampaignDetails,
  listProjectAdAccounts,
  listProjectAdCampaigns,
  listProjectAdLanguages,
  searchProjectAdLocations,
  updateProjectAdCampaign,
} from "@/services/project-ad-accounts.service";
import {
  getProjectAdMarketProfile,
  listProjectAdMarketKeywords,
} from "@/services/project-ad-market.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import {
  adCampaignLink,
  callAds,
  findAdAccount,
  parseAdSpec,
} from "./ads-helpers";
import { type RuntimeOperations } from "./operations";

/**
 * Ads share the social gate: an owner chat turn. A Project bot also stays in its own Project, like
 * the studio tools; that refusal comes before anything is read or sent.
 * Schedules and other non-chat turns cannot spend or change campaigns.
 */
export async function requireAdsAccess(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  projectId: string,
  /** Reads spend nothing: Cuso reads results in his weekly review too. */
  { read = false }: { read?: boolean } = {},
) {
  const cmoRead =
    read && getSokoBotVersion(authorized.turn.versionId).profile === "cmo";
  if (authorized.turn.source !== "CHAT" && !cmoRead) {
    throw new SokoBotRuntimeAuthorizationError(
      "Ads tools are only available when a person asks in chat.",
    );
  }
  const refusal = sokoBotProjectRefusal(authorized.reader.sharedScope, [
    projectId,
  ]);
  if (refusal) throw new SokoBotRefusedUnsentError(refusal);
  const workspace = await runtime.requireSocialAccess(
    authorized,
    prisma,
    "Project ads tools are only available for the owner",
  );
  return workspace;
}

/**
 * Ads reach the provider only through the Project's ad account and the
 * services behind the Ads page, never a Composio connection of the bot's
 * own. A service refusal or provider failure becomes a message the model
 * can read.
 */
export async function executeAdsTool(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
) {
  const { workspaceId } = authorized.turn;
  switch (input.capability) {
    case "list_ad_accounts": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.list_ad_accounts.parse(
        input.input,
      );
      await runtime.requireAdsAccess(authorized, params.projectId, {
        read: true,
      });
      const accounts = await callAds(() =>
        listProjectAdAccounts({ ...params, workspaceId }),
      );
      return {
        accounts: accounts.map(
          ({ id, provider, externalAccountId, name, currency }) => ({
            id,
            provider,
            externalAccountId,
            name,
            currency,
          }),
        ),
        ...(accounts.length === 0
          ? {
              note: "No ad account is connected to this Project. A person connects one on the Ads page; you never connect Google Ads or Meta Ads yourself.",
            }
          : {}),
      };
    }
    case "list_ad_campaigns": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.list_ad_campaigns.parse(
        input.input,
      );
      await runtime.requireAdsAccess(authorized, params.projectId, {
        read: true,
      });
      const { projectId, accountId } = params;
      const [accounts, result] = await callAds(() =>
        Promise.all([
          listProjectAdAccounts({ projectId, workspaceId }),
          listProjectAdCampaigns({ ...params, workspaceId }),
        ]),
      );
      // Only Google campaigns have a details page.
      const google =
        accounts.find((account) => account.id === accountId)?.provider ===
        "google_ads";
      return {
        ...result,
        campaigns: result.campaigns.map((campaign) =>
          google
            ? {
                ...campaign,
                link: adCampaignLink(projectId, accountId, campaign.id),
              }
            : campaign,
        ),
      };
    }
    case "find_ad_targeting": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.find_ad_targeting.parse(
        input.input,
      );
      await runtime.requireAdsAccess(authorized, params.projectId);
      const { projectId, accountId, locationQuery } = params;
      const scope = { projectId, accountId, workspaceId };
      const languages = await callAds(() => listProjectAdLanguages(scope));
      if (locationQuery === undefined) return languages;
      const locations = await callAds(() =>
        searchProjectAdLocations({ ...scope, q: locationQuery }),
      );
      return { ...languages, ...locations };
    }
    case "get_market_keywords": {
      const { projectId } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.get_market_keywords.parse(input.input);
      await runtime.requireAdsAccess(authorized, projectId, {
        read: true,
      });
      const scope = { projectId, workspaceId };
      const profile = await callAds(() => getProjectAdMarketProfile(scope));
      if (!profile)
        return {
          keywords: [],
          note: "No Market profile is set for this Project. A person sets one on the Ads page's Market tab.",
        };
      const { keywords, fetchedAt } = await callAds(() =>
        listProjectAdMarketKeywords(scope),
      );
      const { countryCode, languageCode, locationId } = profile;
      return {
        market: {
          countryCode,
          languageCode,
          locationId,
          seedKeywords: profile.keywords,
        },
        keywords: keywords.map(
          ({
            keyword,
            searchVolume,
            competition,
            cpc,
            lowTopOfPageBid,
            highTopOfPageBid,
          }) => ({
            keyword,
            searchVolume,
            competition,
            cpc,
            lowTopOfPageBid,
            highTopOfPageBid,
          }),
        ),
        currency: "USD",
        fetchedAt: fetchedAt.toISOString(),
      };
    }
    case "create_ad_campaign": {
      const { projectId, accountId, name, dailyBudget, google } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.create_ad_campaign.parse(input.input);
      const workspace = await runtime.requireAdsAccess(authorized, projectId);
      const account = await findAdAccount(projectId, accountId, workspaceId);
      if (account.provider !== "google_ads")
        throw new SokoBotRefusedUnsentError(
          "Meta campaigns can be created on the Ads page",
        );
      const spec = parseAdSpec(
        googleCampaignSpecSchema,
        google.type === "DISPLAY"
          ? {
              ...google,
              images: await runtime.resolveAdImages(authorized, google.images),
            }
          : google,
      );
      const { id } = await callAds(() =>
        createProjectAdCampaign({
          projectId,
          accountId,
          workspaceId,
          userId: actingMemberOf(authorized),
          organizationId: workspace.organizationId,
          name,
          dailyBudget,
          google: spec,
        }),
      );
      return {
        campaignId: id,
        status: "PAUSED" as const,
        link: adCampaignLink(projectId, accountId, id),
        note: "Created paused. Resume it with update_ad_campaign only when the owner asks.",
      };
    }
    case "get_ad_campaign": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.get_ad_campaign.parse(
        input.input,
      );
      await runtime.requireAdsAccess(authorized, params.projectId, {
        read: true,
      });
      const { projectId, accountId, campaignId } = params;
      const details = await callAds(() =>
        getProjectAdCampaignDetails({ ...params, workspaceId }),
      );
      return {
        ...details,
        link: adCampaignLink(projectId, accountId, campaignId),
      };
    }
    case "update_ad_campaign": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.update_ad_campaign.parse(
        input.input,
      );
      await runtime.requireAdsAccess(authorized, params.projectId);
      const { projectId, accountId, campaignId, status, dailyBudget } = params;
      const account = await findAdAccount(projectId, accountId, workspaceId);
      await callAds(() => updateProjectAdCampaign({ ...params, workspaceId }));
      return {
        campaignId,
        updated: true as const,
        ...(status !== undefined ? { status } : {}),
        ...(dailyBudget !== undefined ? { dailyBudget } : {}),
        // Only Google campaigns have a details page.
        ...(account.provider === "google_ads"
          ? { link: adCampaignLink(projectId, accountId, campaignId) }
          : {}),
      };
    }
    case "delete_ad_campaign": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.delete_ad_campaign.parse(
        input.input,
      );
      await runtime.requireAdsAccess(authorized, params.projectId);
      const { projectId, accountId, campaignId } = params;
      await findAdAccount(projectId, accountId, workspaceId);
      // The service's lookups and 404s come before its one provider write.
      await callAds(() =>
        deleteProjectAdCampaign({
          projectId,
          workspaceId,
          accountId,
          campaignId,
        }),
      );
      return { campaignId, deleted: true as const };
    }
    case "edit_ad_campaign": {
      const { projectId, accountId, campaignId, name, dailyBudget, google } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.edit_ad_campaign.parse(input.input);
      const workspace = await runtime.requireAdsAccess(authorized, projectId);
      const account = await findAdAccount(projectId, accountId, workspaceId);
      if (account.provider !== "google_ads")
        throw new SokoBotRefusedUnsentError(
          "Meta campaigns are edited on the Ads page",
        );
      // New images (`fileId`) are resolved and cropped; kept ones (`assetId`)
      // stay as the details gave them, each in its place.
      let newIndex = 0;
      const added =
        google.type === "DISPLAY"
          ? await runtime.resolveAdImages(
              authorized,
              google.images.filter((image) => "fileId" in image),
            )
          : [];
      const spec = parseAdSpec(
        googleCampaignEditSpecSchema,
        google.type === "DISPLAY"
          ? {
              ...google,
              images: google.images.map((image) =>
                "fileId" in image ? added[newIndex++] : image,
              ),
            }
          : google,
      );
      await callAds(() =>
        editProjectAdCampaign({
          projectId,
          accountId,
          campaignId,
          workspaceId,
          userId: actingMemberOf(authorized),
          organizationId: workspace.organizationId,
          name,
          dailyBudget,
          google: spec,
        }),
      );
      return {
        campaignId,
        edited: true as const,
        link: adCampaignLink(projectId, accountId, campaignId),
      };
    }
    default:
      throw new SokoBotRuntimeValidationError("Not an ads tool");
  }
}
