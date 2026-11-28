import {
  type Agent,
  type AgentMetadataOverride,
  type Prisma,
} from "@sokosumi/database";
import type { PrismaRaw } from "@sokosumi/database/client";
import { netType } from "@sokosumi/database/sql-tables";
import type { Agent as MasumiAgent } from "@sokosumi/masumi/types";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import { TIME } from "@/config/constants";
import {
  getCardanoV2ReadySources as readCardanoReadiness,
  getCreditCostsOrThrow as readRequiredRates,
} from "@/lib/agent-catalog/availability";
import type { NetworkScope, SharedDb } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { Network } from "@/lib/network";

import { unprocessableEntity } from "./error";

type AgentMetadataOverrideScalars = AgentMetadataOverride;

export const getAgentImage = (
  agent: Pick<Agent, "image"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "image"> | null;
  },
): string | null => {
  const image = agent.metadataOverride?.image ?? agent.image;
  if (!image) {
    return null;
  }
  return resolveIpfsOrHttpUrl(image);
};

export const getAgentIcon = (agent: Pick<Agent, "icon">): string | null => {
  if (!agent.icon) {
    return null;
  }
  return resolveIpfsOrHttpUrl(agent.icon);
};

export const getAgentName = (
  agent: Pick<Agent, "name"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "name"> | null;
  },
): string => {
  return agent.metadataOverride?.name ?? agent.name;
};

export const getAgentDescription = (
  agent: Pick<Agent, "description"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "description"> | null;
  },
): string | null => {
  return agent.metadataOverride?.description ?? agent.description;
};

export const getAgentAuthorImage = (
  agent: Pick<Agent, "authorImage"> & {
    metadataOverride?: Partial<
      Pick<AgentMetadataOverrideScalars, "authorImage">
    > | null;
  },
): string | null => {
  const image = agent.metadataOverride?.authorImage ?? agent.authorImage;
  if (!image) {
    return null;
  }
  return resolveIpfsOrHttpUrl(image);
};

export function getAgentApiBaseUrl(
  agent: Pick<Agent, "apiBaseUrl"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "apiBaseUrl"> | null;
  },
): string | null {
  return agent.metadataOverride?.apiBaseUrl ?? agent.apiBaseUrl;
}

export function toMasumiAgent(
  agent: Pick<Agent, "id" | "name" | "blockchainIdentifier" | "apiBaseUrl"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "apiBaseUrl"> | null;
  },
): MasumiAgent {
  // OpenApi/X402 pointer entries have no MIP-003 endpoint; they are excluded
  // from availability, so this only triggers on direct-by-id access.
  const apiBaseUrl = getAgentApiBaseUrl(agent);
  if (!apiBaseUrl) {
    throw unprocessableEntity("Agent has no API endpoint");
  }
  return {
    id: agent.id,
    name: agent.name,
    blockchainIdentifier: agent.blockchainIdentifier,
    apiBaseUrl,
    metadataOverride: agent.metadataOverride
      ? { apiBaseUrl: agent.metadataOverride.apiBaseUrl }
      : null,
  };
}

/**
 * Resolves the immutable agent execution context captured when a job started.
 * Legacy jobs without snapshots fall back to the current Agent row.
 */
export function toMasumiAgentForJob(job: {
  agentBlockchainIdentifier?: string | null;
  agentApiBaseUrl?: string | null;
  agent: Pick<Agent, "id" | "name" | "blockchainIdentifier" | "apiBaseUrl"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "apiBaseUrl"> | null;
  };
}): MasumiAgent {
  const currentApiBaseUrl = getAgentApiBaseUrl(job.agent);
  const apiBaseUrl = job.agentApiBaseUrl ?? currentApiBaseUrl;
  if (!apiBaseUrl) {
    throw unprocessableEntity("Agent has no API endpoint");
  }

  return {
    id: job.agent.id,
    name: job.agent.name,
    blockchainIdentifier:
      job.agentBlockchainIdentifier ?? job.agent.blockchainIdentifier,
    apiBaseUrl,
    // The snapshot is already the effective endpoint; a later metadata
    // override must not redirect an active job.
    metadataOverride: null,
  };
}

export interface JobDetailsAgentOverrideFields {
  overrideName: string | null;
  overrideImage: string | null;
  overrideLegalPrivacyPolicy: string | null;
  overrideLegalTerms: string | null;
  overrideLegalDpa: string | null;
  overrideLegalOther: string | null;
}

export function getJobDetailsAgentOverrideFields(agent: {
  metadataOverride?: Pick<
    AgentMetadataOverrideScalars,
    | "name"
    | "image"
    | "legalPrivacyPolicy"
    | "legalTerms"
    | "legalDpa"
    | "legalOther"
  > | null;
}): JobDetailsAgentOverrideFields {
  const override = agent.metadataOverride;
  return {
    overrideName: override?.name ?? null,
    overrideImage: override?.image ?? null,
    overrideLegalPrivacyPolicy: override?.legalPrivacyPolicy ?? null,
    overrideLegalTerms: override?.legalTerms ?? null,
    overrideLegalDpa: override?.legalDpa ?? null,
    overrideLegalOther: override?.legalOther ?? null,
  };
}

export {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  buildAvailableAgentWhereClause,
  type CardanoV2ReadySource,
  isCardanoV2SourceReady,
} from "@/lib/agent-catalog/availability";

export const getCreditCostsOrThrow = (tx: Prisma.TransactionClient = prisma) =>
  readRequiredRates(tx.creditCost);

export const getCardanoV2ReadySources = (
  tx: SharedDb = prisma,
  // shortcut: callers off the Network scope read Mainnet's row; they pass their scope's Network when they move to it.
  network: Network = "mainnet",
) => readCardanoReadiness(tx, network);

export const calculateAverageExecutionTime = async (
  agentId: string,
  scope: NetworkScope,
): Promise<number | null> => {
  // Calculate cutoff date in JavaScript to avoid SQL injection risk
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - TIME.AGENT_EXECUTION_METRICS_DAYS);

  const result = await scope.networkDb.$queryRaw<
    [{ avg_duration_seconds: PrismaRaw.Decimal | null }]
  >`
    SELECT 
      AVG(EXTRACT(EPOCH FROM (completed_event."createdAt" - j."createdAt"))) as avg_duration_seconds
    FROM ${scope.networkTable("Job")} j
    INNER JOIN LATERAL (
      SELECT js."createdAt"
      FROM ${scope.networkTable("jobEvent")} js
      WHERE js."jobId" = j.id
      AND js."status" = 'COMPLETED'::${netType(scope.network, "AgentJobStatus")}
      ORDER BY js."createdAt" DESC
      LIMIT 1
    ) completed_event ON true
    WHERE j."agentId" = ${agentId}
    AND j."createdAt" >= ${cutoffDate}
    `;
  const averageDurationSeconds = result[0]?.avg_duration_seconds ?? null;
  return averageDurationSeconds ? averageDurationSeconds.toNumber() : null;
};
