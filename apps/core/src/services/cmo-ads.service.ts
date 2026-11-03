import type { CmoSearchAd } from "@sokosumi/soko-bot";
import { isProjectAdProvider } from "@/config/ads-providers";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import { hasSocialBetaAccess } from "@/helpers/social-beta-access";
import type { AdCampaign, AdRange } from "@/lib/ads/campaigns";
import type { AvailableAdAccount } from "@/lib/ads/composio-tools";
import prisma from "@/lib/db/prisma";
import {
  CmoConflictError,
  CmoForbiddenError,
  CmoNotFoundError,
  type Cuso,
  cmoPayer,
  requireCuso,
} from "@/services/cmo-cuso.service";
import { completeComposioCallback } from "@/services/composio-callback-completion.service";
import {
  approvedMarketingStrategy,
  listMarketingStrategyFiles,
  mayApproveMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";
import {
  attachProjectAdAccounts,
  createProjectAdCampaign,
  finalizeProjectAdConnection,
  initiateProjectAdConnection,
  listProjectAdAccounts,
  listProjectAdCampaigns,
  listProjectAdConnectionChoices,
  listProjectAdLanguages,
  searchProjectAdLocations,
  updateProjectAdCampaign,
} from "@/services/project-ad-accounts.service";

/**
 * Sokosumi Ads in CMO (the owner's Project ad accounts, ADR 0062): connect
 * Google Ads or Meta Ads, read the campaigns, and launch the search ads Cuso
 * wrote. Ads stay in Sokosumi's Ads beta, so only its members get them. Cuso
 * never starts spending: the owner launches, and Core keeps the daily total
 * inside the approved plan's ad budget.
 */

/** Whether this person may use ads in CMO: Sokosumi's Ads beta. */
export function cmoAdsAvailable(userId: string): Promise<boolean> {
  return hasSocialBetaAccess(userId, prisma);
}

/** Cuso, for an owner or admin in the Ads beta: only they connect or spend. */
async function requireAdsOwner(userId: string): Promise<Cuso> {
  const cuso = await requireCuso({ userId });
  if (!(await cmoAdsAvailable(userId))) {
    throw new CmoForbiddenError("Ads are not open to you yet");
  }
  const { organizationId } = await cmoPayer(cuso);
  const mayApprove = await mayApproveMarketingStrategy(userId, {
    id: cuso.workspaceId,
    userId: null,
    organizationId,
  });
  if (!mayApprove) {
    throw new CmoForbiddenError("Only an owner or admin manages ads");
  }
  return cuso;
}

function scopeOf(cuso: Cuso) {
  return { projectId: cuso.projectId, workspaceId: cuso.workspaceId };
}

/** Starts connecting an ad account; the owner comes back to returnUrl on CMO. */
export async function connectCmoAds(input: {
  userId: string;
  provider: string;
  returnUrl: string;
}): Promise<{ redirectUrl: string }> {
  if (!isProjectAdProvider(input.provider)) {
    throw new CmoNotFoundError("CMO connects Google Ads and Meta Ads only");
  }
  if (!isFirstPartyAppUrl(input.returnUrl)) {
    throw new CmoConflictError("The return address must be CMO's own page");
  }
  const cuso = await requireAdsOwner(input.userId);
  const { redirectUrl } = await initiateProjectAdConnection({
    ...scopeOf(cuso),
    userId: input.userId,
    provider: input.provider,
    callbackUrl: input.returnUrl,
  });
  return { redirectUrl };
}

export type CmoAdsFinalized =
  | { state: "connected" }
  /** The login reaches no ad account: nothing was kept. */
  | { state: "none" }
  /** Several ad accounts: the owner picks the one Cuso's ads run in. */
  | { state: "choose"; adConnectionId: string; accounts: AvailableAdAccount[] };

/**
 * Finishes a connection once the owner is back: redeems the provider's
 * callback, keeps the connection, and attaches its only ad account. Safe to
 * repeat after a reload.
 */
export async function finalizeCmoAds(input: {
  userId: string;
  connectionId: string;
  sessionUri: string | null;
}): Promise<CmoAdsFinalized> {
  const cuso = await requireAdsOwner(input.userId);
  const scope = scopeOf(cuso);
  const kept = await prisma.projectAdConnection.findUnique({
    where: { composioConnectedAccountId: input.connectionId },
    select: { id: true },
  });
  if (!kept && input.sessionUri) {
    await completeComposioCallback({
      connectionId: input.connectionId,
      sessionUri: input.sessionUri,
      userId: input.userId,
    });
  }
  const result = await finalizeProjectAdConnection({
    ...scope,
    userId: input.userId,
    connectionId: input.connectionId,
  });
  if (!result.connection) return { state: "none" };
  const attached = await prisma.projectAdAccount.count({
    where: { connectionId: result.connection.id },
  });
  if (attached > 0) return { state: "connected" };
  const [only, ...more] = result.availableAccounts;
  if (only && more.length === 0) {
    await attachProjectAdAccounts({
      ...scope,
      adConnectionId: result.connection.id,
      externalAccountIds: [only.externalAccountId],
    });
    return { state: "connected" };
  }
  return {
    state: "choose",
    adConnectionId: result.connection.id,
    accounts: result.availableAccounts,
  };
}

/** The ad accounts a connection reaches, for the owner to pick one. */
export async function listCmoAdChoices(input: {
  userId: string;
  adConnectionId: string;
}): Promise<AvailableAdAccount[]> {
  const cuso = await requireAdsOwner(input.userId);
  return listProjectAdConnectionChoices({
    ...scopeOf(cuso),
    adConnectionId: input.adConnectionId,
  });
}

/** Attaches the ad account the owner picked. */
export async function chooseCmoAdAccount(input: {
  userId: string;
  adConnectionId: string;
  externalAccountId: string;
}): Promise<void> {
  const cuso = await requireAdsOwner(input.userId);
  await attachProjectAdAccounts({
    ...scopeOf(cuso),
    adConnectionId: input.adConnectionId,
    externalAccountIds: [input.externalAccountId],
  });
}

export interface CmoAdAccountCampaigns {
  account: { id: string; name: string; provider: string; currency: string };
  campaigns: AdCampaign[];
  /** The provider did not answer; the other accounts still show. */
  failed: boolean;
}

/** Every attached ad account with its campaigns and numbers over the range. */
export async function listCmoAdCampaigns(input: {
  userId: string;
  range: AdRange;
}): Promise<CmoAdAccountCampaigns[]> {
  const cuso = await requireCuso({ userId: input.userId });
  if (!(await cmoAdsAvailable(input.userId))) return [];
  const scope = scopeOf(cuso);
  const accounts = await listProjectAdAccounts(scope);
  return Promise.all(
    accounts.map(async (account) => {
      const summary = {
        id: account.id,
        name: account.name,
        provider: account.provider,
        currency: account.currency,
      };
      try {
        const { campaigns } = await listProjectAdCampaigns({
          ...scope,
          accountId: account.id,
          range: input.range,
        });
        return { account: summary, campaigns, failed: false };
      } catch {
        return { account: summary, campaigns: [], failed: true };
      }
    }),
  );
}

/** The approved plan's ad budget a day: what all running campaigns may spend. */
async function dailyAdBudget(cuso: Cuso) {
  const approved = await approvedMarketingStrategy(cuso.projectId);
  const plan = parseMarketingPlan(approved?.plan);
  if (!approved || !plan) {
    throw new CmoConflictError("Approve a plan before launching ads");
  }
  const ads = plan.ads;
  if (!ads || ads.monthly <= 0) {
    throw new CmoConflictError(
      "Your plan has no ad budget. Ask Cuso to add one, then launch.",
    );
  }
  return {
    approved,
    plan,
    currency: ads.currency.toUpperCase(),
    monthly: ads.monthly,
    perDay: ads.monthly / 30,
  };
}

/** Money as the owner reads it: "EUR 12.50". */
function money(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

/** What the running campaigns in this currency spend a day, leaving one out. */
async function runningPerDay(
  cuso: Cuso,
  currency: string,
  leaveOut?: { accountId: string; campaignId: string },
): Promise<number> {
  const scope = scopeOf(cuso);
  const accounts = (await listProjectAdAccounts(scope)).filter(
    (account) => account.currency.toUpperCase() === currency,
  );
  let total = 0;
  for (const account of accounts) {
    const { campaigns } = await listProjectAdCampaigns({
      ...scope,
      accountId: account.id,
      range: "LAST_7_DAYS",
    });
    for (const campaign of campaigns) {
      const left =
        leaveOut?.accountId === account.id &&
        leaveOut.campaignId === campaign.id;
      if (campaign.status === "ACTIVE" && !left) {
        total += campaign.dailyBudget ?? 0;
      }
    }
  }
  return total;
}

/**
 * Refuses a daily budget that takes the running campaigns past the plan's
 * ad budget, or an account that bills in another currency than the plan.
 */
export async function requireAdBudgetRoom(input: {
  cuso: Cuso;
  account: { id: string; currency: string };
  campaignId?: string;
  dailyBudget: number;
}): Promise<void> {
  const budget = await dailyAdBudget(input.cuso);
  if (input.account.currency.toUpperCase() !== budget.currency) {
    throw new CmoConflictError(
      `Your plan's ad budget is in ${budget.currency}, but this ad account bills in ${input.account.currency}. Ask Cuso to set the budget in ${input.account.currency}.`,
    );
  }
  const running = await runningPerDay(
    input.cuso,
    budget.currency,
    input.campaignId
      ? { accountId: input.account.id, campaignId: input.campaignId }
      : undefined,
  );
  if (running + input.dailyBudget > budget.perDay + 0.005) {
    throw new CmoConflictError(
      `That would spend ${money(running + input.dailyBudget, budget.currency)} a day, and your plan allows ${money(budget.perDay, budget.currency)} (${money(budget.monthly, budget.currency)} a month). Pause another ad or raise the budget.`,
    );
  }
}

/** Google's ids for where and in which language the ad runs. */
async function googleTargeting(
  scope: { projectId: string; workspaceId: string; accountId: string },
  ad: CmoSearchAd,
): Promise<{ locationIds: string[]; languageIds: string[] }> {
  const location = ad.location
    ? (await searchProjectAdLocations({ ...scope, q: ad.location }))
        .locations[0]
    : undefined;
  const language = ad.language
    ? (await listProjectAdLanguages(scope)).languages.find(
        (candidate) => candidate.code.toLowerCase() === ad.language,
      )
    : undefined;
  return {
    locationIds: location ? [location.id] : [],
    languageIds: language ? [language.id] : [],
  };
}

/** Cents are what Google charges: a budget with more decimals is refused. */
function roundBudget(amount: number): number {
  return Math.floor(amount * 100) / 100;
}

/**
 * Launches a search ad Cuso wrote: Core builds the Google campaign from its
 * parts in the Project's Google Ads account, with an equal share of the
 * plan's daily ad budget, then starts it. A piece launched before is started
 * again. Only an owner or admin launches.
 */
export async function launchCmoSearchAd(input: {
  userId: string;
  entryId: string;
}): Promise<void> {
  const cuso = await requireAdsOwner(input.userId);
  const scope = scopeOf(cuso);
  const budget = await dailyAdBudget(cuso);
  const files = await listMarketingStrategyFiles(budget.approved);
  const piece = files.get(input.entryId);
  const entry = budget.plan.calendar.find((item) => item.id === input.entryId);
  if (!piece?.searchAd || !entry) {
    throw new CmoNotFoundError("That ad is not written yet");
  }
  if (piece.adCampaign) {
    await setCmoAdCampaignStatus({
      userId: input.userId,
      ...piece.adCampaign,
      status: "ACTIVE",
    });
    return;
  }
  const account = (await listProjectAdAccounts(scope)).find(
    (candidate) => candidate.provider === "google_ads",
  );
  if (!account) {
    throw new CmoConflictError("Connect a Google Ads account first");
  }
  // Every search ad in the plan gets the same share of the daily budget.
  const searchAds = [...files.values()].filter((file) => file.searchAd).length;
  const dailyBudget = roundBudget(budget.perDay / Math.max(searchAds, 1));
  if (dailyBudget <= 0) {
    throw new CmoConflictError("Your ad budget is too small for a daily ad");
  }
  await requireAdBudgetRoom({ cuso, account, dailyBudget });
  const ad = piece.searchAd;
  const { id: campaignId } = await createProjectAdCampaign({
    ...scope,
    accountId: account.id,
    userId: input.userId,
    organizationId: (await cmoPayer(cuso)).organizationId,
    name: `${entry.title} (CMO)`,
    dailyBudget,
    google: {
      type: "SEARCH",
      ...(await googleTargeting({ ...scope, accountId: account.id }, ad)),
      finalUrl: ad.finalUrl,
      keywords: ad.keywords.map((text) => ({ text, matchType: "PHRASE" })),
      headlines: ad.headlines,
      descriptions: ad.descriptions,
      ...(ad.callouts?.length ? { callouts: ad.callouts } : {}),
    },
  });
  // Kept before it starts, so a failed start leaves a paused campaign to retry.
  await prisma.marketingStrategyFile.update({
    where: {
      marketingStrategyId_entryId: {
        marketingStrategyId: budget.approved.id,
        entryId: input.entryId,
      },
    },
    data: { adAccountId: account.id, adCampaignId: campaignId },
  });
  await updateProjectAdCampaign({
    ...scope,
    accountId: account.id,
    campaignId,
    status: "ACTIVE",
  });
}

/**
 * Pauses or starts a campaign in the Project's ad account. Starting one is
 * held to the plan's daily ad budget.
 */
export async function setCmoAdCampaignStatus(input: {
  userId: string;
  accountId: string;
  campaignId: string;
  status: "ACTIVE" | "PAUSED";
}): Promise<void> {
  const cuso = await requireAdsOwner(input.userId);
  const scope = scopeOf(cuso);
  if (input.status === "ACTIVE") {
    const account = (await listProjectAdAccounts(scope)).find(
      (candidate) => candidate.id === input.accountId,
    );
    if (!account) throw new CmoNotFoundError("Ad account not found");
    const { campaigns } = await listProjectAdCampaigns({
      ...scope,
      accountId: account.id,
      range: "LAST_7_DAYS",
    });
    const campaign = campaigns.find((item) => item.id === input.campaignId);
    if (!campaign) throw new CmoNotFoundError("Campaign not found");
    await requireAdBudgetRoom({
      cuso,
      account,
      campaignId: campaign.id,
      dailyBudget: campaign.dailyBudget ?? 0,
    });
  }
  await updateProjectAdCampaign({
    ...scope,
    accountId: input.accountId,
    campaignId: input.campaignId,
    status: input.status,
  });
}
