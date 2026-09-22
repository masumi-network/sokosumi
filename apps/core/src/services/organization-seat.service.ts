import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { badRequest, notFound } from "@/helpers/error";

/** Shown when a seat write keeps losing the serialization race (SOK-1007). */
export const SEAT_ASSIGNMENT_CONFLICT_MESSAGE =
  "Seat assignment lost a concurrent update. Try again.";

/** Shown when automatic seat reconciliation keeps losing that race (SOK-1007). */
export const SEAT_RECONCILIATION_CONFLICT_MESSAGE =
  "Seat reconciliation lost a concurrent update. Try again.";

/** Shown when a purchased-seat change keeps losing that race (SOK-1007). */
export const SEAT_CHANGE_CONFLICT_MESSAGE =
  "Seat update lost a concurrent update. Try again.";

/**
 * Maps member-repository seat errors to HTTP exceptions; rethrows everything
 * else (including HTTP exceptions thrown by guards inside the transaction).
 */
export function mapSeatRepositoryError(error: unknown): never {
  if (error instanceof HTTPException || !(error instanceof Error)) {
    throw error;
  }

  if (error.message === "Member not found") {
    throw notFound("Member not found", {
      kind: CORE_API_ERROR_KINDS.MEMBER_NOT_FOUND,
    });
  }

  if (error.message.includes("exceeds purchased seats")) {
    throw badRequest(
      "No unused seats available. Purchase more seats or unassign another member.",
      { kind: CORE_API_ERROR_KINDS.SEAT_CAPACITY_EXCEEDED },
    );
  }

  throw error;
}
