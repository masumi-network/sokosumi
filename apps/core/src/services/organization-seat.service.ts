import type { Prisma } from "@sokosumi/database";
import { memberRepository } from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { badRequest, notFound } from "@/helpers/error";

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

export async function unassignOrganizationMemberSeat(
  organizationId: string,
  memberId: string,
  tx: Prisma.TransactionClient,
): Promise<{ memberId: string }> {
  const member = await memberRepository.unassignSeat(
    memberId,
    organizationId,
    tx,
  );

  return {
    memberId: member.id,
  };
}
