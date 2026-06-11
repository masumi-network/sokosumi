import type {
  AgentRatingStats,
  AgentWithCreditsPrice,
  JobShare,
  JobWithSokosumiStatus,
  UserAgentRatingWithUser,
} from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/utils";

import type {
  Agent as CoreAgent,
  AgentDetail as CoreAgentDetail,
  AgentMyReview as CoreAgentMyReview,
  AgentRatingDistribution as CoreAgentRatingDistribution,
  AgentReview as CoreAgentReview,
  AgentReviews as CoreAgentReviews,
  Category as CoreCategory,
  Job as CoreJob,
  JobShare as CoreJobShare,
  JobSummary as CoreJobSummary,
} from "@/lib/clients/generated/core";
import { SYNTHETIC_DEFAULT_CATEGORY } from "@/lib/constants/agent-categories";
import type { Category } from "@/lib/types/category";

type CoreAgentDto = CoreAgent | CoreAgentDetail;

/** Fields returned by Core for paid jobs; optional until OpenAPI client is regenerated. */
interface CoreJobChainPayload {
  blockchainIdentifier?: string | null;
  payByTime?: Date | string | null;
  submitResultTime?: Date | string | null;
  unlockTime?: Date | string | null;
  externalDisputeUnlockTime?: Date | string | null;
  sellerVkey?: string | null;
}

interface MappedAgentReviews {
  ratingDistribution: Record<number, number>;
  ratingsWithComments: UserAgentRatingWithUser[];
}

const COMPATIBILITY_DATE = new Date(0);

function toDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : COMPATIBILITY_DATE;
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value == null) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

function readCoreJobChainFields(job: CoreJobSummary): {
  blockchainIdentifier: string | null;
  payByTime: Date | null;
  submitResultTime: Date | null;
  unlockTime: Date | null;
  externalDisputeUnlockTime: Date | null;
  sellerVkey: string | null;
} {
  const payload = job as CoreJobSummary & CoreJobChainPayload;

  return {
    blockchainIdentifier: payload.blockchainIdentifier ?? null,
    payByTime: toDateOrNull(payload.payByTime),
    submitResultTime: toDateOrNull(payload.submitResultTime),
    unlockTime: toDateOrNull(payload.unlockTime),
    externalDisputeUnlockTime: toDateOrNull(payload.externalDisputeUnlockTime),
    sellerVkey: payload.sellerVkey ?? null,
  };
}

function isCoreAgentDetail(agent: CoreAgentDto): agent is CoreAgentDetail {
  return "riskClassification" in agent;
}

function createCompatibilityAgentDate(agent: CoreAgentDto): Date {
  return toDate(agent.updatedAt ?? agent.createdAt);
}

function mapCoreAgentCategory(
  agent: CoreAgentDto,
  category: CoreAgentDto["categories"][number],
) {
  const date = createCompatibilityAgentDate(agent);

  return {
    id: category.id,
    createdAt: date,
    updatedAt: date,
    name: category.name,
    slug: category.slug,
    description: category.description ?? null,
    image: category.image ?? null,
    icon: category.icon ?? null,
    priority: category.priority,
    styles: category.styles ?? null,
  };
}

function mapCoreAgentTags(agent: CoreAgentDto) {
  if (!isCoreAgentDetail(agent)) {
    return [];
  }

  const date = createCompatibilityAgentDate(agent);

  return agent.tags.map((tag, index) => ({
    id: `${agent.id}-tag-${index}`,
    createdAt: date,
    updatedAt: date,
    name: tag,
  }));
}

function mapCoreAgentExampleOutputs(agent: CoreAgentDto) {
  if (!isCoreAgentDetail(agent)) {
    return [];
  }

  const date = createCompatibilityAgentDate(agent);

  return agent.exampleOutputs.map((output, index) => ({
    id: `${agent.id}-example-output-${index}`,
    createdAt: date,
    updatedAt: date,
    name: output.name,
    mimeType: output.mimeType,
    url: output.url,
    agentId: agent.id,
    agentIdOverride: null,
  }));
}

function mapCoreJobAgent(
  agentId: string,
  agent?: Partial<CoreJob["agent"]> | null,
) {
  return {
    id: agentId,
    name: agent?.name ?? agentId,
    overrideName: agent?.overrideName ?? null,
    icon: agent?.icon ?? null,
    image: agent?.image ?? null,
    overrideImage: agent?.overrideImage ?? null,
    legalPrivacyPolicy: agent?.legalPrivacyPolicy ?? null,
    overrideLegalPrivacyPolicy: agent?.overrideLegalPrivacyPolicy ?? null,
    legalTerms: agent?.legalTerms ?? null,
    overrideLegalTerms: agent?.overrideLegalTerms ?? null,
    legalDpa: agent?.legalDpa ?? null,
    overrideLegalDpa: agent?.overrideLegalDpa ?? null,
    legalOther: agent?.legalOther ?? null,
    overrideLegalOther: agent?.overrideLegalOther ?? null,
  };
}

function isJobSettled(job: {
  completedAt: Date | null;
  externalDisputeUnlockTime: Date | null;
  jobType: JobWithSokosumiStatus["jobType"];
}) {
  switch (job.jobType) {
    case "DEMO":
      return true;
    case "FREE":
      return job.completedAt !== null;
    case "PAID":
      return job.externalDisputeUnlockTime
        ? new Date() > job.externalDisputeUnlockTime
        : false;
    default:
      return false;
  }
}

function mapCoreJobEvent(event: CoreJob["events"][number]) {
  return {
    id: event.id,
    createdAt: toDate(event.createdAt),
    updatedAt: toDate(event.updatedAt),
    status: event.status,
    inputSchema: event.inputSchema ?? null,
    input: event.input
      ? {
          id: event.input.id,
          input: event.input.input,
          inputHash: event.input.inputHash ?? null,
          signature: event.input.signature ?? null,
        }
      : null,
    result: event.result ?? null,
    blobs: event.blobs.map((blob) => ({
      id: blob.id,
      createdAt: toDate(blob.createdAt),
      updatedAt: toDate(blob.updatedAt),
      jobId: blob.jobId,
      sourceUrl: blob.sourceUrl,
      name: blob.name ?? null,
      status: blob.status,
      size: blob.size != null ? BigInt(blob.size) : null,
      mimeType: blob.mimeType ?? null,
      fileUrl: blob.fileUrl ?? null,
    })),
    links: event.links.map((link) => ({
      id: link.id,
      createdAt: toDate(link.createdAt),
      updatedAt: toDate(link.updatedAt),
      jobId: link.jobId,
      url: link.url,
      title: link.title ?? null,
    })),
  };
}

export function mapCoreAgentMetricsToRatingStats(
  agent: Pick<CoreAgentDto, "metrics">,
): AgentRatingStats {
  return {
    totalRatings: agent.metrics.ratings.total,
    averageRating: agent.metrics.ratings.average ?? 0,
  };
}

export function mapCoreAgentRatingDistribution(
  distribution: CoreAgentRatingDistribution,
): Record<number, number> {
  return {
    1: distribution[1] ?? 0,
    2: distribution[2] ?? 0,
    3: distribution[3] ?? 0,
    4: distribution[4] ?? 0,
    5: distribution[5] ?? 0,
  };
}

export function mapCoreAgentReview(
  review: CoreAgentReview,
): UserAgentRatingWithUser {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment ?? null,
    createdAt: toDate(review.createdAt),
    updatedAt: toDate(review.updatedAt),
    user: {
      id: review.user.id,
      name: review.user.name,
      image: review.user.image ?? null,
    },
  };
}

/** The caller's own rating for an agent; consumers only need rating + comment. */
export interface UserAgentRatingSummary {
  rating: number;
  comment: string | null;
}

export function mapCoreMyAgentReview(
  review: CoreAgentMyReview,
): UserAgentRatingSummary | null {
  if (!review) {
    return null;
  }

  return {
    rating: review.rating,
    comment: review.comment ?? null,
  };
}

export function mapCoreAgentReviews(
  reviews: CoreAgentReviews,
): MappedAgentReviews {
  return {
    ratingDistribution: mapCoreAgentRatingDistribution(reviews.distribution),
    ratingsWithComments: reviews.ratingsWithComments.map(mapCoreAgentReview),
  };
}

export function mapCoreAgentRatingStatsMap(
  agents: CoreAgentDto[],
): Record<string, AgentRatingStats> {
  return Object.fromEntries(
    agents.map((agent) => [agent.id, mapCoreAgentMetricsToRatingStats(agent)]),
  );
}

export function mapCoreCategoryToCategory(category: CoreCategory): Category {
  return {
    slug: category.slug,
    name: category.name,
    priority: category.priority,
    description: category.description ?? undefined,
    image: category.image ?? undefined,
    icon: category.icon ?? undefined,
    styles: category.styles ?? undefined,
  };
}

export function mapCoreCategoriesToCategories(
  categories: CoreCategory[],
): Category[] {
  const mappedCategories = categories.map(mapCoreCategoryToCategory);
  const hasSyntheticDefaultCategory = mappedCategories.some(
    (category) => category.slug === SYNTHETIC_DEFAULT_CATEGORY.slug,
  );

  return hasSyntheticDefaultCategory
    ? mappedCategories
    : [...mappedCategories, SYNTHETIC_DEFAULT_CATEGORY];
}

export function mapCoreAgentToAgentWithCreditsPrice(
  agent: CoreAgentDto,
): AgentWithCreditsPrice {
  const createdAt = toDate(agent.createdAt);
  const updatedAt = toDate(agent.updatedAt);
  const compatibilityDate = createCompatibilityAgentDate(agent);

  const mappedAgent = {
    id: agent.id,
    createdAt,
    updatedAt,
    blockchainIdentifier: agent.id,
    name: agent.name,
    overrideName: null,
    description: agent.description ?? null,
    overrideDescription: null,
    apiBaseUrl: "",
    overrideApiBaseUrl: null,
    capabilityName: null,
    overrideCapabilityName: null,
    capabilityVersion: null,
    overrideCapabilityVersion: null,
    authorName: agent.author.name ?? null,
    overrideAuthorName: null,
    authorImage: agent.author.image ?? null,
    overrideAuthorImage: null,
    authorContactEmail: agent.author.email ?? null,
    overrideAuthorContactEmail: null,
    authorContactOther: agent.author.other ?? null,
    overrideAuthorContactOther: null,
    authorOrganization: agent.author.organization ?? null,
    overrideAuthorOrganization: null,
    legalPrivacyPolicy: agent.legal.privacyPolicy ?? null,
    overrideLegalPrivacyPolicy: null,
    legalDpa: agent.legal.dpa ?? null,
    overrideLegalDpa: null,
    legalTerms: agent.legal.terms ?? null,
    overrideLegalTerms: null,
    legalOther: agent.legal.other ?? null,
    overrideLegalOther: null,
    lastUptimeCheck: compatibilityDate,
    uptimeCount: 0,
    uptimeCheckCount: 0,
    image: agent.image ?? null,
    overrideImage: null,
    icon: agent.icon ?? null,
    metadataVersion: 1,
    paymentType: "WEB3_CARDANO_V1",
    pricingId: `${agent.id}-core-pricing`,
    pricing: {
      id: `${agent.id}-core-pricing`,
      createdAt: compatibilityDate,
      updatedAt: compatibilityDate,
      pricingType: agent.credits === 0 ? "FREE" : "UNKNOWN",
      fixedPricing: null,
      agentFixedPricingId: null,
    },
    status: "ONLINE",
    isShown: true,
    riskClassification: isCoreAgentDetail(agent)
      ? agent.riskClassification
      : "MINIMAL",
    exampleOutput: mapCoreAgentExampleOutputs(agent),
    overrideExampleOutput: [],
    userAgentRating: [],
    jobs: [],
    tags: mapCoreAgentTags(agent),
    overrideTags: [],
    categories: agent.categories.map((category) =>
      mapCoreAgentCategory(agent, category),
    ),
    demoInput: null,
    demoOutput: null,
    summary: agent.summary ?? null,
    creditsPrice: {
      cents: convertCreditsToCents(agent.credits),
    },
  };

  return mappedAgent as AgentWithCreditsPrice;
}

export function createUnavailableAgentWithCreditsPrice(
  agentId: string,
): AgentWithCreditsPrice {
  const compatibilityDate = COMPATIBILITY_DATE;
  const mappedAgent = {
    id: agentId,
    createdAt: compatibilityDate,
    updatedAt: compatibilityDate,
    blockchainIdentifier: agentId,
    name: agentId,
    overrideName: null,
    description: null,
    overrideDescription: null,
    apiBaseUrl: "",
    overrideApiBaseUrl: null,
    capabilityName: null,
    overrideCapabilityName: null,
    capabilityVersion: null,
    overrideCapabilityVersion: null,
    authorName: null,
    overrideAuthorName: null,
    authorImage: null,
    overrideAuthorImage: null,
    authorContactEmail: null,
    overrideAuthorContactEmail: null,
    authorContactOther: null,
    overrideAuthorContactOther: null,
    authorOrganization: null,
    overrideAuthorOrganization: null,
    legalPrivacyPolicy: null,
    overrideLegalPrivacyPolicy: null,
    legalDpa: null,
    overrideLegalDpa: null,
    legalTerms: null,
    overrideLegalTerms: null,
    legalOther: null,
    overrideLegalOther: null,
    lastUptimeCheck: compatibilityDate,
    uptimeCount: 0,
    uptimeCheckCount: 0,
    image: null,
    overrideImage: null,
    icon: null,
    metadataVersion: 1,
    paymentType: "WEB3_CARDANO_V1",
    pricingId: `${agentId}-unavailable-pricing`,
    pricing: {
      id: `${agentId}-unavailable-pricing`,
      createdAt: compatibilityDate,
      updatedAt: compatibilityDate,
      pricingType: "UNKNOWN",
      fixedPricing: null,
      agentFixedPricingId: null,
    },
    status: "OFFLINE",
    isShown: false,
    riskClassification: "MINIMAL",
    exampleOutput: [],
    overrideExampleOutput: [],
    userAgentRating: [],
    jobs: [],
    tags: [],
    overrideTags: [],
    categories: [],
    demoInput: null,
    demoOutput: null,
    summary: null,
    creditsPrice: {
      cents: BigInt(0),
    },
  };

  return mappedAgent as AgentWithCreditsPrice;
}

export function mapCoreAgentsToAgentWithCreditsPrice(
  agents: CoreAgentDto[],
): AgentWithCreditsPrice[] {
  return agents.map(mapCoreAgentToAgentWithCreditsPrice);
}

export function mapCoreJobSummaryToJobWithSokosumiStatus(
  job: CoreJobSummary,
): JobWithSokosumiStatus {
  const completedAt = job.completedAt ? toDate(job.completedAt) : null;
  const chain = readCoreJobChainFields(job);
  const { externalDisputeUnlockTime } = chain;

  const mappedJob = {
    id: job.id,
    createdAt: toDate(job.createdAt),
    updatedAt: toDate(job.updatedAt),
    completedAt,
    agentId: job.agentId,
    userId: job.userId,
    organizationId: job.organizationId ?? null,
    projectId: job.projectId ?? null,
    taskId: job.taskId ?? null,
    name: job.name ?? null,
    jobType: job.jobType,
    status: job.status,
    credits: job.credits,
    onChainStatus: job.onChainStatus ?? null,
    onChainTransactionHash: job.onChainTransactionHash ?? null,
    result: job.result ?? null,
    resultHash: job.resultHash ?? null,
    input: null,
    inputHash: null,
    inputSchema: null,
    agentJobId: job.id,
    identifierFromPurchaser: null,
    blockchainIdentifier: chain.blockchainIdentifier,
    payByTime: chain.payByTime,
    submitResultTime: chain.submitResultTime,
    unlockTime: chain.unlockTime,
    externalDisputeUnlockTime,
    sellerVkey: chain.sellerVkey,
    purchaseId: null,
    transactionId: null,
    refundedTransaction: null,
    refundedTransactionId: null,
    share: null,
    task: null,
    purchase: null,
    transaction: null,
    events: [],
    cents: convertCreditsToCents(job.credits),
    jobStatusSettled: isJobSettled({
      completedAt,
      externalDisputeUnlockTime,
      jobType: job.jobType,
    }),
    user: {
      id: job.user.id,
      name: job.user.name,
      image: job.user.image ?? null,
    },
    organization: job.organization
      ? {
          id: job.organization.id,
          name: job.organization.name,
          slug: job.organization.slug,
        }
      : null,
    workspace: {
      id: job.workspace.id,
      organizationId: job.workspace.organizationId ?? null,
      organization: job.workspace.organization
        ? {
            id: job.workspace.organization.id,
            name: job.workspace.organization.name,
            slug: job.workspace.organization.slug,
          }
        : null,
    },
    agent: mapCoreJobAgent(job.agentId),
  };

  return mappedJob as unknown as JobWithSokosumiStatus;
}

export function mapCoreJobShare(share: CoreJobShare): JobShare {
  return {
    id: share.id,
    jobId: share.jobId,
    token: share.token,
    allowSearchIndexing: share.allowSearchIndexing,
    createdAt: toDate(share.createdAt),
    updatedAt: toDate(share.updatedAt),
  } as JobShare;
}

export function mapCoreJobToJobWithSokosumiStatus(
  job: CoreJob,
  options?: { share?: JobShare | null },
): JobWithSokosumiStatus {
  const mappedJob = {
    ...mapCoreJobSummaryToJobWithSokosumiStatus(job),
    input: job.input ?? null,
    inputHash: job.inputHash ?? null,
    inputSchema: job.inputSchema ?? null,
    agentJobId: job.agentJobId,
    identifierFromPurchaser: job.identifierFromPurchaser ?? null,
    share: options?.share ?? (job.share ? mapCoreJobShare(job.share) : null),
    agent: mapCoreJobAgent(job.agentId, job.agent),
    events: job.events.map(mapCoreJobEvent),
    // Token-based public share pages are read-only; keep "unsettled" so
    // downstream UI matches the legacy mapCoreSharedJob contract (no
    // post-dispute / settled-only affordances for anonymous viewers).
    ...(options?.share != null ? { jobStatusSettled: false } : {}),
  };

  return mappedJob as unknown as JobWithSokosumiStatus;
}
