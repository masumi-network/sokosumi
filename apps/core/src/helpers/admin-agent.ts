import type { z } from "@hono/zod-openapi";
import {
  type Agent,
  type AgentMetadataOverride,
  type AgentStatus,
  agentExampleOutputInclude,
  agentTagsInclude,
  type Prisma,
} from "@sokosumi/database";

import {
  getAgentApiBaseUrl,
  getAgentDescription,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent";
import {
  adminAgentDetailSchema,
  adminAgentListItemSchema,
  adminAgentMetadataOverrideSchema,
  adminAgentRegistrySchema,
} from "@/schemas/admin-agent.schema";
import {
  getAgentExampleOutputsFromAgent,
  getAgentLegalFromAgent,
  getAgentTagsFromAgent,
  getAuthorFromAgent,
} from "@/schemas/agent.schema";

type AdminAgentListItem = z.infer<typeof adminAgentListItemSchema>;
type AdminAgentRegistry = z.infer<typeof adminAgentRegistrySchema>;
type AdminAgentMetadataOverride = z.infer<
  typeof adminAgentMetadataOverrideSchema
>;
type AdminAgentDetail = z.infer<typeof adminAgentDetailSchema>;

export const adminAgentListInclude = {
  metadataOverride: {
    select: {
      name: true,
      image: true,
    },
  },
} as const;

export type AdminAgentListRecord = Prisma.AgentGetPayload<{
  include: typeof adminAgentListInclude;
}>;

/**
 * Registry tags/examples plus override relations (tags + exampleOutputs).
 * Both shared includes embed `agentMetadataOverrideRelationsInclude`.
 */
export const adminAgentDetailInclude = {
  ...agentTagsInclude,
  ...agentExampleOutputInclude,
} as const;

export type AdminAgentDetailRecord = Prisma.AgentGetPayload<{
  include: typeof adminAgentDetailInclude;
}>;

function mapAdminAgentRegistry(agent: Agent): AdminAgentRegistry {
  return adminAgentRegistrySchema.parse({
    id: agent.id,
    blockchainIdentifier: agent.blockchainIdentifier,
    name: agent.name,
    description: agent.description,
    apiBaseUrl: agent.apiBaseUrl,
    type: agent.type,
    openApiSpecUrl: agent.openApiSpecUrl,
    x402ResourcesUrl: agent.x402ResourcesUrl,
    paymentType: agent.paymentType,
    metadataVersion: agent.metadataVersion,
    supersededByAgentIdentifier: agent.supersededByAgentIdentifier,
    capabilityName: agent.capabilityName,
    capabilityVersion: agent.capabilityVersion,
    authorName: agent.authorName,
    authorImage: agent.authorImage,
    authorContactEmail: agent.authorContactEmail,
    authorContactOther: agent.authorContactOther,
    authorOrganization: agent.authorOrganization,
    legalPrivacyPolicy: agent.legalPrivacyPolicy,
    legalDpa: agent.legalDpa,
    legalTerms: agent.legalTerms,
    legalOther: agent.legalOther,
    image: agent.image,
    icon: agent.icon,
    status: agent.status,
    isShown: agent.isShown,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  });
}

function mapAdminAgentMetadataOverride(
  override:
    | (AgentMetadataOverride & {
        tags: Array<{ name: string }>;
        exampleOutputs: Array<{
          name: string;
          mimeType: string;
          url: string;
        }>;
      })
    | null,
): AdminAgentMetadataOverride {
  if (!override) {
    return null;
  }

  return adminAgentMetadataOverrideSchema.parse({
    name: override.name,
    description: override.description,
    apiBaseUrl: override.apiBaseUrl,
    capabilityName: override.capabilityName,
    capabilityVersion: override.capabilityVersion,
    authorName: override.authorName,
    authorImage: override.authorImage,
    authorContactEmail: override.authorContactEmail,
    authorContactOther: override.authorContactOther,
    authorOrganization: override.authorOrganization,
    legalPrivacyPolicy: override.legalPrivacyPolicy,
    legalDpa: override.legalDpa,
    legalTerms: override.legalTerms,
    legalOther: override.legalOther,
    image: override.image,
    tags: override.tags.map((tag) => tag.name),
    exampleOutputs: override.exampleOutputs.map((example) => ({
      name: example.name,
      mimeType: example.mimeType,
      url: example.url,
    })),
  });
}

export function mapAdminAgentListItem(
  agent: AdminAgentListRecord,
): AdminAgentListItem {
  return adminAgentListItemSchema.parse({
    id: agent.id,
    blockchainIdentifier: agent.blockchainIdentifier,
    registryName: agent.name,
    hasOverride: agent.metadataOverride !== null,
    displayName: getAgentName(agent),
    displayImage: getAgentImage(agent),
    status: agent.status,
    isShown: agent.isShown,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  });
}

export function mapAdminAgentDetail(
  agent: AdminAgentDetailRecord,
): AdminAgentDetail {
  const author = getAuthorFromAgent(agent);
  const legal = getAgentLegalFromAgent(agent);

  return adminAgentDetailSchema.parse({
    registry: mapAdminAgentRegistry(agent),
    override: mapAdminAgentMetadataOverride(agent.metadataOverride),
    resolved: {
      name: getAgentName(agent),
      description: getAgentDescription(agent),
      image: getAgentImage(agent),
      apiBaseUrl: getAgentApiBaseUrl(agent),
      authorName: author.name,
      authorImage: author.image,
      authorContactEmail: author.email,
      authorContactOther: author.other,
      authorOrganization: author.organization,
      legalPrivacyPolicy: legal.privacyPolicy,
      legalDpa: legal.dpa,
      legalTerms: legal.terms,
      legalOther: legal.other,
      tags: getAgentTagsFromAgent(agent),
      exampleOutputs: getAgentExampleOutputsFromAgent(agent),
    },
  });
}

export type AdminAgentListSortBy =
  | "displayName"
  | "registryName"
  | "hasOverride"
  | "status"
  | "createdAt";

export type AdminAgentListSortOrder = "asc" | "desc";

export function buildAdminAgentListOrderBy(
  sortBy: Exclude<AdminAgentListSortBy, "displayName">,
  sortOrder: AdminAgentListSortOrder,
): Prisma.AgentOrderByWithRelationInput[] {
  switch (sortBy) {
    case "createdAt":
      return [{ createdAt: sortOrder }, { id: sortOrder }];
    case "status":
      return [{ status: sortOrder }, { id: sortOrder }];
    case "registryName":
      return [{ name: sortOrder }, { id: sortOrder }];
    case "hasOverride":
      return [{ metadataOverride: { id: sortOrder } }, { id: sortOrder }];
    default: {
      const _exhaustive: never = sortBy;
      return _exhaustive;
    }
  }
}

function buildAdminAgentSearchWhere(
  query?: string,
): Prisma.AgentWhereInput | undefined {
  const trimmed = query?.trim();
  if (!trimmed) {
    return undefined;
  }

  return {
    OR: [
      { name: { contains: trimmed, mode: "insensitive" } },
      { blockchainIdentifier: { contains: trimmed, mode: "insensitive" } },
      {
        metadataOverride: {
          is: {
            name: { contains: trimmed, mode: "insensitive" },
          },
        },
      },
    ],
  };
}

export function buildAdminAgentListWhere({
  q,
  status,
}: {
  q?: string;
  status?: AgentStatus;
}): Prisma.AgentWhereInput | undefined {
  const filters: Prisma.AgentWhereInput[] = [];

  const searchWhere = buildAdminAgentSearchWhere(q);
  if (searchWhere) {
    filters.push(searchWhere);
  }

  if (status) {
    filters.push({ status });
  }

  if (filters.length === 0) {
    return undefined;
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return { AND: filters };
}

export function buildMetadataOverrideScalarUpdate(
  body: Record<string, string | null | undefined>,
): Prisma.AgentMetadataOverrideUpdateInput {
  const data: Prisma.AgentMetadataOverrideUpdateInput = {};

  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      (data as Record<string, string | null>)[key] = value;
    }
  }

  return data;
}
