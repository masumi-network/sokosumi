import { ComposioConfigError } from "@/clients/composio.client";
import {
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from "@/helpers/error";
import { mapControlPlaneError } from "@/routes/v1/soko-bots/helpers";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import {
  CmoConflictError,
  CmoForbiddenError,
  CmoNotFoundError,
} from "@/services/cmo-cuso.service";
import {
  type CmoOverview,
  getCmoOverview,
} from "@/services/cmo-overview.service";
import { SokoBotIntegrationError } from "@/services/soko-bot-integrations.service";

function mapOverview(overview: CmoOverview) {
  const { cuso } = overview;
  return cmoOverviewSchema.parse({
    businessName: cuso.businessName,
    websiteUrl: cuso.websiteUrl,
    organizationSlug: overview.organizationSlug,
    projectName: overview.projectName,
    workspaceId: cuso.workspaceId,
    sokoBotId: cuso.sokoBotId,
    projectId: cuso.projectId,
    roomId: overview.roomId,
    botStatus: overview.botStatus,
    learning: overview.learning,
    work: overview.work,
    brandVisual: overview.brandVisual,
    projectLogo: overview.projectLogo,
    onboardingStep: overview.onboardingStep,
    routines: overview.routines,
    subscriptionActive: overview.subscriptionActive,
    viewerCanApprove: overview.viewerCanApprove,
    mockBilling: overview.mockBilling,
    mockPlan: overview.mockPlan,
    mockPlanActivatedAt: overview.mockPlanActivatedAt,
    brandBrain: overview.brandBrain,
    brandBrainUpdatedAt: cuso.brandBrainUpdatedAt,
    brandBrainConfirmedAt: cuso.brandBrainConfirmedAt,
    brandMedia: overview.brandMedia,
    strategy: overview.strategy,
    media: overview.media,
    strategyVersion: overview.strategyVersions[0] ?? null,
    strategyVersions: overview.strategyVersions,
    updates: overview.updates.map(
      ({ previousVersionId, versionId, revertedAt, ...update }) => ({
        ...update,
        revertible: !!previousVersionId && !!versionId && !revertedAt,
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
    production: overview.production,
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
    createdAt: cuso.createdAt,
  });
}

export async function requireOverview(userId: string) {
  const overview = await getCmoOverview(userId);
  if (!overview) throw notFound("Cuso is not hired yet");
  return mapOverview(overview);
}

export function rethrow(error: unknown): never {
  if (error instanceof CmoNotFoundError) throw notFound(error.message);
  if (error instanceof CmoConflictError) throw conflict(error.message);
  if (error instanceof CmoForbiddenError) throw forbidden(error.message);
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
  // Cuso busy, paused or out of credits: as on the Soko Bot routes.
  mapControlPlaneError(error);
}
