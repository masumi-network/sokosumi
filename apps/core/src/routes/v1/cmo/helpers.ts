import { ComposioConfigError } from "@/clients/composio.client";
import {
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from "@/helpers/error";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import {
  CmoConflictError,
  CmoNotFoundError,
  type CmoOverview,
  getCmoOverview,
} from "@/services/cmo.service";
import { parseCmoBrandMedia } from "@/services/cmo-brand-media.service";
import { SokoBotBillingAccessError } from "@/services/soko-bot-billing.service";
import { SokoBotIntegrationError } from "@/services/soko-bot-integrations.service";

function mapOverview(overview: CmoOverview) {
  const { hire } = overview;
  return cmoOverviewSchema.parse({
    id: hire.id,
    businessName: hire.businessName,
    websiteUrl: hire.websiteUrl,
    goals: hire.goals,
    organizationSlug: overview.organizationSlug,
    projectName: overview.projectName,
    workspaceId: hire.workspaceId,
    sokoBotId: hire.sokoBotId,
    projectId: hire.projectId,
    roomId: overview.roomId,
    botStatus: overview.botStatus,
    learning: overview.learning,
    work: overview.work,
    brandVisual: overview.brandVisual,
    projectLogo: overview.projectLogo,
    accountsDoneAt: hire.accountsDoneAt,
    onboardedAt: hire.onboardedAt,
    routines: overview.routines,
    subscriptionActive: overview.subscriptionActive,
    mockBilling: overview.mockBilling,
    mockPlan: overview.mockPlan,
    mockPlanActivatedAt: overview.mockPlanActivatedAt,
    brandBrain: overview.brandBrain,
    brandBrainUpdatedAt: hire.brandBrainUpdatedAt,
    brandBrainApprovedAt: hire.brandBrainApprovedAt,
    brandMedia: parseCmoBrandMedia(hire.brandMedia),
    strategy: overview.strategy,
    media: overview.media,
    strategyUpdatedAt: hire.strategyUpdatedAt,
    strategyApprovedAt: hire.strategyApprovedAt,
    updates: overview.updates.map(
      ({ previousStrategy, revertedAt, ...update }) => ({
        ...update,
        revertible: previousStrategy !== undefined && !revertedAt,
        revertedAt: revertedAt ?? null,
      }),
    ),
    channels: overview.channels.map((channel) => ({
      id: channel.id,
      provider: channel.provider,
      handle: channel.externalHandle,
      displayName: channel.displayName,
      status: channel.status,
    })),
    upNext: overview.upNext,
    connectChannelUrl: overview.connectChannelUrl,
    adProviders: overview.adProviders,
    connectAdsUrl: overview.connectAdsUrl,
    measurement: overview.measurement,
    mailingListSize: overview.mailingListSize,
    subscribeUrl: overview.subscribeUrl,
    billing: overview.billing,
    posts: {
      draft: overview.posts.DRAFT ?? 0,
      scheduled:
        (overview.posts.SCHEDULED ?? 0) + (overview.posts.PUBLISHING ?? 0),
      published: overview.posts.PUBLISHED ?? 0,
      failed: (overview.posts.FAILED ?? 0) + (overview.posts.MISSED ?? 0),
    },
    createdAt: hire.createdAt,
  });
}

export async function requireOverview(userId: string) {
  const overview = await getCmoOverview(userId);
  if (!overview) throw notFound("Cuso is not hired yet");
  return mapOverview(overview);
}

export function rethrow(error: unknown): never {
  if (error instanceof CmoNotFoundError) throw notFound(error.message);
  // Out of credits: the founder can top up and try again.
  if (error instanceof SokoBotBillingAccessError)
    throw forbidden(error.message);
  if (error instanceof CmoConflictError) throw conflict(error.message);
  if (
    error instanceof ComposioConfigError ||
    (error instanceof SokoBotIntegrationError &&
      error.kind === "NOT_CONFIGURED")
  ) {
    throw serviceUnavailable("Connecting this network is not set up");
  }
  if (error instanceof SokoBotIntegrationError) {
    if (error.kind === "NOT_FOUND") throw notFound("Not connected yet");
    throw serviceUnavailable(
      "Connecting is not working right now. Try again later.",
    );
  }
  throw error;
}
