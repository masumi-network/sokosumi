import type { z } from "@hono/zod-openapi";
import type { AgentStatus } from "@sokosumi/database";
import { netTable, netType } from "@sokosumi/database/sql-tables";

import {
  type AdminAgentListSortBy,
  type AdminAgentListSortOrder,
  adminAgentDetailInclude,
  adminAgentListInclude,
  buildAdminAgentListOrderBy,
  buildAdminAgentListWhere,
  buildMetadataOverrideScalarUpdate,
} from "@/helpers/admin-agent";
import { conflict, notFound } from "@/helpers/error";
import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
import type { NetworkDb, NetworkScope, SharedDb } from "@/lib/db/network-scope";
import type { patchAdminAgentMetadataOverrideBodySchema } from "@/schemas/admin-agent.schema";

// Admin reads and edits take every Agent of the scope's Network: no
// availability rule (ADR 0086).

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

// On the shared client with the Network's schema-qualified names: the scope's
// Network side has tagged raw SQL only, which cannot bind one value twice.
async function findAdminAgentIdsOrderedByDisplayName(
  scope: NetworkScope,
  options: {
    sortOrder: AdminAgentListSortOrder;
    take: number;
    cursor?: string;
    q?: string;
    status?: AgentStatus;
  },
): Promise<string[]> {
  const client: SharedDb = scope.sharedDb;
  const agentTable = netTable(scope.network, "Agent").sql;
  const overrideTable = netTable(scope.network, "AgentMetadataOverride").sql;
  const statusType = netType(scope.network, "AgentStatus").sql;
  const direction = options.sortOrder === "asc" ? "ASC" : "DESC";
  const trimmed = options.q?.trim();
  const searchPattern = trimmed ? `%${escapeIlikeLiteral(trimmed)}%` : null;
  const status = options.status ?? null;

  if (options.cursor) {
    const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
      `
      WITH ordered AS (
        SELECT
          a.id,
          ROW_NUMBER() OVER (
            ORDER BY COALESCE(o.name, a.name) ${direction}, a.id ${direction}
          ) AS rn
        FROM ${agentTable} a
        LEFT JOIN ${overrideTable} o ON o."agentId" = a.id
        WHERE (
          $1::text IS NULL
          OR a.name ILIKE $1 ESCAPE '\\'
          OR a."blockchainIdentifier" ILIKE $1 ESCAPE '\\'
          OR o.name ILIKE $1 ESCAPE '\\'
        )
        AND ($2::${statusType} IS NULL OR a.status = $2::${statusType})
      )
      SELECT id
      FROM ordered
      WHERE rn > (SELECT rn FROM ordered WHERE id = $3)
      ORDER BY rn
      LIMIT $4
      `,
      searchPattern,
      status,
      options.cursor,
      options.take,
    );
    return rows.map((row) => row.id);
  }

  const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
    `
    SELECT a.id
    FROM ${agentTable} a
    LEFT JOIN ${overrideTable} o ON o."agentId" = a.id
    WHERE (
      $1::text IS NULL
      OR a.name ILIKE $1 ESCAPE '\\'
      OR a."blockchainIdentifier" ILIKE $1 ESCAPE '\\'
      OR o.name ILIKE $1 ESCAPE '\\'
    )
    AND ($2::${statusType} IS NULL OR a.status = $2::${statusType})
    ORDER BY COALESCE(o.name, a.name) ${direction}, a.id ${direction}
    LIMIT $3
    `,
    searchPattern,
    status,
    options.take,
  );
  return rows.map((row) => row.id);
}

/**
 * One page of Agents for the admin list: `take` rows after `cursor`, the
 * count of every Agent the filters match, and whether a next page exists.
 */
export async function listAgents(
  scope: NetworkScope,
  options: {
    q?: string;
    status?: AgentStatus;
    sortBy: AdminAgentListSortBy;
    sortOrder: AdminAgentListSortOrder;
    cursor?: string;
    take: number;
  },
) {
  const { q, status, sortBy, sortOrder, cursor, take } = options;
  const filters = {
    ...(q !== undefined && { q }),
    ...(status !== undefined && { status }),
  };
  const listWhere = buildAdminAgentListWhere(filters);
  const whereArg = { ...(listWhere !== undefined && { where: listWhere }) };

  if (sortBy === "displayName") {
    // Read first: a refused scope throws here, before either read starts.
    const db = scope.networkDb;
    const [orderedIds, total] = await Promise.all([
      findAdminAgentIdsOrderedByDisplayName(scope, {
        sortOrder,
        take: take + 1,
        ...(cursor !== undefined && { cursor }),
        ...filters,
      }),
      db.agent.count(whereArg),
    ]);

    const agents =
      orderedIds.length === 0
        ? []
        : await db.agent.findMany({
            where: { id: { in: orderedIds } },
            include: adminAgentListInclude,
          });
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const orderedAgents = orderedIds.flatMap((id) => {
      const agent = byId.get(id);
      return agent ? [agent] : [];
    });

    return {
      agents: orderedAgents.slice(0, take),
      total,
      hasMore: orderedIds.length === take + 1,
    };
  }

  const orderBy = buildAdminAgentListOrderBy(sortBy, sortOrder);
  const [agents, total] = await scope.netBatch((db) => [
    db.agent.findMany({
      ...whereArg,
      include: adminAgentListInclude,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy,
    }),
    db.agent.count(whereArg),
  ]);

  return {
    agents: agents.slice(0, take),
    total,
    hasMore: agents.length === take + 1,
  };
}

/** One Agent with its registry data and override, or null. */
export function getAgent(scope: NetworkScope, id: string) {
  return scope.networkDb.agent.findUnique({
    where: { id },
    include: adminAgentDetailInclude,
  });
}

async function requireAgentDetail(scope: NetworkScope, id: string) {
  const agent = await getAgent(scope, id);
  if (!agent) {
    throw notFound("Agent not found");
  }
  return agent;
}

async function requireAgentExists(scope: NetworkScope, id: string) {
  const agent = await scope.networkDb.agent.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!agent) {
    throw notFound("Agent not found");
  }
}

async function resolveTagsByNames(tx: NetworkDb, tagNames: string[]) {
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

/**
 * Deletes an override row when every admin-editable scalar is null and both
 * collections are empty, so empty PATCH bodies do not leave a useless
 * `hasOverride` record.
 *
 * `capabilityName` / `capabilityVersion` are not part of the admin write
 * surface (marketplace never merged them). They are ignored for prune so
 * migrated leftovers cannot keep a sticky empty-looking override.
 */
export async function pruneEmptyMetadataOverride(
  tx: NetworkDb,
  overrideId: string,
): Promise<boolean> {
  const override = await tx.agentMetadataOverride.findUnique({
    where: { id: overrideId },
    include: {
      tags: { select: { id: true }, take: 1 },
      exampleOutputs: { select: { id: true }, take: 1 },
    },
  });

  if (!override) {
    return false;
  }

  const hasScalar =
    override.name !== null ||
    override.description !== null ||
    override.apiBaseUrl !== null ||
    override.authorName !== null ||
    override.authorImage !== null ||
    override.authorContactEmail !== null ||
    override.authorContactOther !== null ||
    override.authorOrganization !== null ||
    override.legalPrivacyPolicy !== null ||
    override.legalDpa !== null ||
    override.legalTerms !== null ||
    override.legalOther !== null ||
    override.image !== null;

  if (
    hasScalar ||
    override.tags.length > 0 ||
    override.exampleOutputs.length > 0
  ) {
    return false;
  }

  await tx.agentMetadataOverride.delete({ where: { id: overrideId } });
  return true;
}

/**
 * Creates or updates an Agent's override: scalars as sent, tags and example
 * outputs replaced when sent, and an override left empty removed, in one
 * transaction. Returns the Agent as the admin detail reads it.
 */
export async function patchOverride(
  scope: NetworkScope,
  id: string,
  patch: z.infer<typeof patchAdminAgentMetadataOverrideBodySchema>,
) {
  await requireAgentExists(scope, id);

  const scalarUpdate = buildMetadataOverrideScalarUpdate({
    name: patch.name,
    description: patch.description,
    apiBaseUrl: patch.apiBaseUrl,
    authorName: patch.authorName,
    authorImage: patch.authorImage,
    authorContactEmail: patch.authorContactEmail,
    authorContactOther: patch.authorContactOther,
    authorOrganization: patch.authorOrganization,
    legalPrivacyPolicy: patch.legalPrivacyPolicy,
    legalDpa: patch.legalDpa,
    legalTerms: patch.legalTerms,
    legalOther: patch.legalOther,
    image: patch.image,
  });

  // Every write is inside the transaction, so a retried attempt repeats
  // nothing that the rolled-back one left behind.
  await scope.netTransaction(async (tx) => {
    // Clear migrated capability leftovers — not on the admin write surface.
    const capabilityClear = {
      capabilityName: null,
      capabilityVersion: null,
    } as const;

    const override = await tx.agentMetadataOverride.upsert({
      where: { agentId: id },
      create: {
        agentId: id,
        ...Object.fromEntries(
          Object.entries(scalarUpdate).map(([key, value]) => [
            key,
            value === undefined ? null : value,
          ]),
        ),
        ...capabilityClear,
      },
      update: {
        ...scalarUpdate,
        ...capabilityClear,
      },
      include: {
        tags: true,
        exampleOutputs: true,
      },
    });

    if (patch.tags !== undefined) {
      const tags = await resolveTagsByNames(tx, patch.tags);
      await tx.agentMetadataOverride.update({
        where: { id: override.id },
        data: {
          tags: {
            set: tags.map((tag) => ({ id: tag.id })),
          },
        },
      });
    }

    if (patch.exampleOutputs !== undefined) {
      await tx.exampleOutput.deleteMany({
        where: { metadataOverrideId: override.id },
      });

      if (patch.exampleOutputs.length > 0) {
        await tx.exampleOutput.createMany({
          data: patch.exampleOutputs.map((example) => ({
            metadataOverrideId: override.id,
            name: example.name,
            mimeType: example.mimeType,
            url: example.url,
          })),
        });
      }
    }

    await pruneEmptyMetadataOverride(tx, override.id);
  }, "Agent override conflict");

  return requireAgentDetail(scope, id);
}

/** Removes an Agent's override, if it has one. Returns the Agent as the admin detail reads it. */
export async function deleteOverride(scope: NetworkScope, id: string) {
  await requireAgentExists(scope, id);

  await scope.networkDb.agentMetadataOverride.deleteMany({
    where: { agentId: id },
  });

  return requireAgentDetail(scope, id);
}

/** One rate, or null. */
export function getRate(scope: NetworkScope, id: string) {
  return scope.networkDb.creditCost.findUnique({
    where: { id },
  });
}

/**
 * A rate for a unit already in its canonical spelling. Every Agent priced in
 * the unit is priced with it from the next read: prices are not stored.
 */
export function createRate(
  scope: NetworkScope,
  unit: string,
  centsPerUnit: bigint,
) {
  return scope.netTransaction(async (tx) => {
    const existing = await tx.creditCost.findUnique({
      where: { unit },
    });
    if (existing) {
      throw conflict("Unit already exists");
    }

    return tx.creditCost.create({
      data: {
        unit,
        centsPerUnit,
      },
    });
  }, "Credit cost conflict");
}

export async function updateRate(
  scope: NetworkScope,
  id: string,
  centsPerUnit: bigint,
) {
  const current = await scope.networkDb.creditCost.findUnique({
    where: { id },
  });
  if (!current) {
    throw notFound("Credit cost not found");
  }

  return scope.networkDb.creditCost.update({
    where: { id },
    data: { centsPerUnit },
  });
}

export async function deleteRate(scope: NetworkScope, id: string) {
  try {
    return await scope.networkDb.creditCost.delete({
      where: { id },
    });
  } catch (error) {
    if (isPrismaRecordNotFoundError(error)) {
      throw notFound("Credit cost not found");
    }
    throw error;
  }
}
