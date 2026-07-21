import type { z } from "@hono/zod-openapi";
import {
  type Agent,
  type AgentMetadataOverride,
  agentExampleOutputInclude,
  agentTagsInclude,
  type Prisma,
} from "@sokosumi/database";

import {
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

export function mapAdminAgentRegistry(agent: Agent): AdminAgentRegistry {
  return adminAgentRegistrySchema.parse({
    id: agent.id,
    blockchainIdentifier: agent.blockchainIdentifier,
    name: agent.name,
    description: agent.description,
    apiBaseUrl: agent.apiBaseUrl,
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

export function mapAdminAgentMetadataOverride(
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
      apiBaseUrl: agent.metadataOverride?.apiBaseUrl ?? agent.apiBaseUrl,
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

/**
 * Prisma cannot `ORDER BY COALESCE(override.name, agent.name)` via relation
 * orderBy. Use SQL so displayName sort matches `getAgentName` (override ?? registry).
 */
function escapeIlikeLiteral(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export async function findAdminAgentIdsOrderedByDisplayName(
  client: Pick<Prisma.TransactionClient, "$queryRawUnsafe">,
  options: {
    sortOrder: AdminAgentListSortOrder;
    take: number;
    cursor?: string;
    q?: string;
  },
): Promise<string[]> {
  const direction = options.sortOrder === "asc" ? "ASC" : "DESC";
  const trimmed = options.q?.trim();
  const searchPattern = trimmed ? `%${escapeIlikeLiteral(trimmed)}%` : null;

  if (options.cursor) {
    const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
      `
      WITH ordered AS (
        SELECT
          a.id,
          ROW_NUMBER() OVER (
            ORDER BY COALESCE(o.name, a.name) ${direction}, a.id ${direction}
          ) AS rn
        FROM "Agent" a
        LEFT JOIN "AgentMetadataOverride" o ON o."agentId" = a.id
        WHERE (
          $1::text IS NULL
          OR a.name ILIKE $1 ESCAPE '\\'
          OR a."blockchainIdentifier" ILIKE $1 ESCAPE '\\'
          OR o.name ILIKE $1 ESCAPE '\\'
        )
      )
      SELECT id
      FROM ordered
      WHERE rn > (SELECT rn FROM ordered WHERE id = $2)
      ORDER BY rn
      LIMIT $3
      `,
      searchPattern,
      options.cursor,
      options.take,
    );
    return rows.map((row) => row.id);
  }

  const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
    `
    SELECT a.id
    FROM "Agent" a
    LEFT JOIN "AgentMetadataOverride" o ON o."agentId" = a.id
    WHERE (
      $1::text IS NULL
      OR a.name ILIKE $1 ESCAPE '\\'
      OR a."blockchainIdentifier" ILIKE $1 ESCAPE '\\'
      OR o.name ILIKE $1 ESCAPE '\\'
    )
    ORDER BY COALESCE(o.name, a.name) ${direction}, a.id ${direction}
    LIMIT $2
    `,
    searchPattern,
    options.take,
  );
  return rows.map((row) => row.id);
}

export function buildAdminAgentSearchWhere(
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

export async function resolveTagsByNames(
  tx: Prisma.TransactionClient,
  tagNames: string[],
) {
  const tags = [];
  for (const name of tagNames) {
    const tag = await tx.tag.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    tags.push(tag);
  }
  return tags;
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
