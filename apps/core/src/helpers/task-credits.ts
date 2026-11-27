import { InsufficientBalanceError } from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import {
  type SpendResult,
  spend,
  spendFailedInPreparation,
} from "@/lib/credits/spend";
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

  let spent: SpendResult<"in_full">;
  try {
    spent = await spend({
      scope: input.scope,
      tx: input.tx,
      payer: {
        // An empty id is no id, for the bucket choice and the debit alike: no
        // row has one (measured on production, 2026-11-27), so only an id no
        // row has is read differently than before the move.
        userId: input.userId || null,
        organizationId: input.organizationId || null,
        projectId: input.projectId ?? null,
      },
      quotedCents: input.cents,
      mode: "in_full",
    });
  } catch (error) {
    // Any failure before the write is a 422, a refused scope and a conflict
    // included; a failed write passes as it is.
    if (spendFailedInPreparation(error) && error instanceof Error) {
      throw unprocessableEntity(error.message);
    }
    throw error;
  }
  if (spent.outcome === "not_charged") {
    throw unprocessableEntity(
      new InsufficientBalanceError(spent.quotedCents, spent.availableCents)
        .message,
      { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    );
  }
  return spent.transactionId;
}
