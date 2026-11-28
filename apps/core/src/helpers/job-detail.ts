import {
  type Agent,
  type AgentMetadataOverride,
  type Blob,
  type Job,
  type JobEvent,
  type JobInput,
  type JobPurchase,
  type Link,
  type SharedDb,
  type Transaction,
  workCreatorInclude,
  workspaceRelationInclude,
} from "@sokosumi/database";

import { internalServerError } from "@/helpers/error";
import type { NetworkScope } from "@/lib/db/network-scope";

/**
 * Loads full Job details on the split layout inside an open shared-side
 * transaction so the read sees the transaction's own snapshot and uses the
 * same connection (no Promise.all inside an interactive transaction).
 */
export async function readJobDetailsOnSplitTx(
  tx: SharedDb,
  scope: NetworkScope,
  id: string,
) {
  const [job] = await tx.$queryRaw<Job[]>`
    SELECT *
    FROM ${scope.networkTable("Job")}
    WHERE "id" = ${id}
    LIMIT 1
  `;
  if (!job) return null;

  const [agent] = await tx.$queryRaw<Agent[]>`
    SELECT *
    FROM ${scope.networkTable("Agent")}
    WHERE "id" = ${job.agentId}
    LIMIT 1
  `;
  if (!agent) {
    throw internalServerError(`Job ${job.id} has no agent`);
  }

  const [metadataOverride] = await tx.$queryRaw<AgentMetadataOverride[]>`
    SELECT *
    FROM ${scope.networkTable("AgentMetadataOverride")}
    WHERE "agentId" = ${agent.id}
    LIMIT 1
  `;

  const [rawTransaction] = job.transactionId
    ? await tx.$queryRaw<Transaction[]>`
        SELECT *
        FROM ${scope.networkTable("Transaction")}
        WHERE "id" = ${job.transactionId}
        LIMIT 1
      `
    : [];
  const transaction = rawTransaction
    ? { ...rawTransaction, amount: BigInt(rawTransaction.amount) }
    : null;

  const [rawRefundedTransaction] = job.refundedTransactionId
    ? await tx.$queryRaw<Transaction[]>`
        SELECT *
        FROM ${scope.networkTable("Transaction")}
        WHERE "id" = ${job.refundedTransactionId}
        LIMIT 1
      `
    : [];
  const refundedTransaction = rawRefundedTransaction
    ? {
        ...rawRefundedTransaction,
        amount: BigInt(rawRefundedTransaction.amount),
      }
    : null;

  const [purchase] = await tx.$queryRaw<JobPurchase[]>`
    SELECT *
    FROM ${scope.networkTable("jobPurchase")}
    WHERE "jobId" = ${job.id}
    LIMIT 1
  `;

  const events = await tx.$queryRaw<JobEvent[]>`
    SELECT *
    FROM ${scope.networkTable("jobEvent")}
    WHERE "jobId" = ${job.id}
    ORDER BY "createdAt" DESC
  `;

  const eventIds = events.map((event) => event.id);
  const inputs =
    eventIds.length > 0
      ? await tx.$queryRaw<JobInput[]>`
          SELECT *
          FROM ${scope.networkTable("jobInput")}
          WHERE "eventId" = ANY(${eventIds}::text[])
        `
      : [];
  const blobs =
    eventIds.length > 0
      ? await tx.$queryRaw<Blob[]>`
          SELECT *
          FROM ${scope.networkTable("blob")}
          WHERE "eventId" = ANY(${eventIds}::text[])
        `
      : [];
  const links =
    eventIds.length > 0
      ? await tx.$queryRaw<Link[]>`
          SELECT *
          FROM ${scope.networkTable("link")}
          WHERE "eventId" = ANY(${eventIds}::text[])
        `
      : [];

  const inputByEventId = new Map(inputs.map((input) => [input.eventId, input]));
  const blobsByEventId = new Map<string, Blob[]>();
  for (const blob of blobs) {
    const normalized: Blob = {
      ...blob,
      size: blob.size === null ? null : BigInt(blob.size),
    };
    const list = blobsByEventId.get(blob.eventId);
    if (list) list.push(normalized);
    else blobsByEventId.set(blob.eventId, [normalized]);
  }
  const linksByEventId = new Map<string, Link[]>();
  for (const link of links) {
    const list = linksByEventId.get(link.eventId);
    if (list) list.push(link);
    else linksByEventId.set(link.eventId, [link]);
  }

  const workspace = await tx.workspace.findUnique({
    where: { id: job.workspaceId },
    ...workspaceRelationInclude.workspace,
  });
  if (!workspace) {
    throw internalServerError(`Job ${job.id} has no workspace`);
  }

  const organization = job.organizationId
    ? await tx.organization.findUnique({
        where: { id: job.organizationId },
      })
    : null;
  const owner = job.ownerId
    ? await tx.user.findUnique({ where: { id: job.ownerId } })
    : null;
  const creatorUser = job.creatorUserId
    ? job.creatorUserId === job.ownerId
      ? owner
      : await tx.user.findUnique({
          where: { id: job.creatorUserId },
          ...workCreatorInclude.creatorUser,
        })
    : null;
  const creatorCoworker = job.creatorCoworkerId
    ? await tx.coworker.findUnique({
        where: { id: job.creatorCoworkerId },
        ...workCreatorInclude.creatorCoworker,
      })
    : null;
  const creatorSokoBot = job.creatorSokoBotId
    ? await tx.sokoBot.findUnique({
        where: { id: job.creatorSokoBotId },
        ...workCreatorInclude.creatorSokoBot,
      })
    : null;
  const share =
    scope.network === "mainnet"
      ? await tx.publicShare.findUnique({ where: { jobId: job.id } })
      : null;

  return {
    ...job,
    workspace,
    organization,
    owner,
    creatorUser,
    creatorCoworker,
    creatorSokoBot,
    agent: {
      ...agent,
      metadataOverride: metadataOverride ?? null,
    },
    transaction,
    refundedTransaction,
    purchase: purchase ?? null,
    events: events.map((event) => ({
      ...event,
      input: inputByEventId.get(event.id) ?? null,
      blobs: blobsByEventId.get(event.id) ?? [],
      links: linksByEventId.get(event.id) ?? [],
    })),
    share,
  };
}
