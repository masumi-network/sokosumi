import { createHash, randomUUID } from "node:crypto";
import { redactSokoBotSensitiveText } from "@sokosumi/soko-bot";
import { canonicalActionJson } from "@/lib/soko-bot/action-receipts";
import { truncateUtf8 } from "@/lib/soko-bot/persisted-value";

export const ERROR_DETAIL_MAX_BYTES = 1_000;

export const SELLER_RESERVATION_MARKER_VERSION = 1;

export interface SellerReservationMarker {
  version: typeof SELLER_RESERVATION_MARKER_VERSION;
  attemptId: string;
  reservedAt: string;
  proposalHash: string;
  error?: string;
}

export function sellerProposalHash(
  toolName: "hire_agent" | "provide_job_input",
  proposal: unknown,
): string {
  return createHash("sha256")
    .update(`${toolName}:${canonicalActionJson(proposal)}`)
    .digest("hex");
}

export function createSellerReservationMarker(
  toolName: "hire_agent" | "provide_job_input",
  proposal: unknown,
): SellerReservationMarker {
  return {
    version: SELLER_RESERVATION_MARKER_VERSION,
    attemptId: randomUUID(),
    reservedAt: new Date().toISOString(),
    proposalHash: sellerProposalHash(toolName, proposal),
  };
}

export function serializeSellerReservationMarker(
  marker: SellerReservationMarker,
  error?: unknown,
): string {
  return JSON.stringify({
    ...marker,
    ...(error === undefined ? {} : { error: persistedErrorDetail(error) }),
  });
}

export function persistedErrorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Unknown error";
  return truncateUtf8(
    redactSokoBotSensitiveText(detail),
    ERROR_DETAIL_MAX_BYTES,
  );
}
