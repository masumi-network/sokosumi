import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { isAPIError } from "better-auth/api";
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
  type CusoTarget,
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
    brandBrain: overview.brandBrain,
    brandBrainUpdatedAt: cuso.brandBrainUpdatedAt,
    brandBrainConfirmedAt: cuso.brandBrainConfirmedAt,
    brandMedia: overview.brandMedia,
    strategy: overview.strategy,
    approvedStrategy: overview.approvedStrategy,
    media: overview.media,
    strategyVersion: overview.strategyVersions[0] ?? null,
    strategyVersions: overview.strategyVersions,
    hiredAt: overview.hiredAt,
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

/** The overview of the Cuso a CMO call names. */
export async function requireOverview(target: CusoTarget) {
  const overview = await getCmoOverview(target);
  if (!overview) throw notFound("Cuso is not hired yet");
  return mapOverview(overview);
}

export function rethrow(error: unknown): never {
  const kind =
    error instanceof Error && "kind" in error && typeof error.kind === "string"
      ? { kind: error.kind }
      : undefined;
  if (error instanceof CmoNotFoundError) throw notFound(error.message, kind);
  if (error instanceof CmoConflictError) throw conflict(error.message, kind);
  if (error instanceof CmoForbiddenError) throw forbidden(error.message, kind);
  // Hiring into a new organization: Better Auth's organization limit.
  if (
    isAPIError(error) &&
    error.body?.code === "YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS"
  ) {
    throw forbidden("You've reached the organization limit", {
      kind: CORE_API_ERROR_KINDS.ORGANIZATION_LIMIT_REACHED,
    });
  }
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
