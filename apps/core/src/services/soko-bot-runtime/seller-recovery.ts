import { createHash, randomUUID } from "node:crypto";
import {
  containsSokoBotSensitiveMaterial,
  redactSokoBotSensitiveText,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
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

const QUOTED = /"[^"\n]*"|“[^”\n]*”/g;

/**
 * A Core refusal keeps its own words and redacts only the customer values it
 * quotes, so "Rewrite the post's first line: …" still counts as a refusal
 * while a quoted card number or key does not reach the row. Unquoted
 * sensitive material redacts the whole message.
 */
function redactQuotedValues(message: string): string {
  const kept = message.replace(QUOTED, (quoted) => {
    const value = quoted.slice(1, -1);
    const safe = redactSokoBotSensitiveText(value);
    return safe === value ? quoted : `${quoted[0]}${safe}${quoted.at(-1)}`;
  });
  return containsSokoBotSensitiveMaterial(kept.replace(QUOTED, '""'))
    ? redactSokoBotSensitiveText(message)
    : kept;
}

/**
 * A Core refusal (a 4xx it raised itself, such as "Rewrite the post: …")
 * keeps its words: redacted whole, 69 post refusals in a week were stored as
 * "[Sensitive value removed]", unreadable for the opening check's count of
 * earlier refusals and for anyone looking into a failure. Anything else can
 * carry a provider's or seller's text, and is redacted whole.
 */
export function persistedErrorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Unknown error";
  const coreRefusal = error instanceof HTTPException && error.status < 500;
  return truncateUtf8(
    coreRefusal
      ? redactQuotedValues(detail)
      : redactSokoBotSensitiveText(detail),
    ERROR_DETAIL_MAX_BYTES,
  );
}
