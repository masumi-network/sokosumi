import {
  type Consumption,
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import type { NetworkScope, SharedDb } from "@/lib/db/network-scope";

import { unprocessableEntity } from "./error";

interface CreateTaskEventTransactionInput {
  /**
   * The member charged: the work's Owner. Null charges the Organization pool
   * with no member (ADR 0057).
   */
  userId: string | null;
  organizationId: string | null;
  /**
   * The Project the work belongs to: its Project credits are spent first,
   * then the pool. Absent or null sees only the pool (ADR 0067).
   */
  projectId?: string | null;
  cents: bigint;
  /** The Network whose credits are spent. */
  scope: NetworkScope;
  /** The open shared-side transaction the charge commits or rolls back with. */
  tx: SharedDb;
}

export function isInsufficientBalanceError(error: unknown): boolean {
  if (!(error instanceof HTTPException) || error.status !== 422) {
    return false;
  }

  const cause = error.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "kind" in cause &&
    cause.kind === CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE
  );
}

export async function createTaskEventTransaction(
  input: CreateTaskEventTransactionInput,
): Promise<string | null> {
  if (input.cents === 0n) {
    return null;
  }

  let consumptions: Consumption[];
  try {
    consumptions = await creditBucketRepository.prepareConsumption(
      input.scope.network,
      input.userId,
      input.organizationId,
      input.cents,
      input.tx,
      { projectId: input.projectId ?? null },
    );
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      throw unprocessableEntity(error.message, {
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
      });
    }
    if (error instanceof Error) {
      throw unprocessableEntity(error.message);
    }
    throw error;
  }

  return await creditBucketRepository.recordSpend(
    input.scope.network,
    {
      // An empty id is no id, as the relation write treated it.
      userId: input.userId || null,
      organizationId: input.organizationId || null,
      cents: input.cents,
      consumptions,
    },
    input.tx,
  );
}
