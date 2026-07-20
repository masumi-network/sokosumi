import type {
  HermesConfirmationCoworkerRef,
  HermesConfirmationOrganizationRef,
  HermesPendingConfirmation,
} from "@/lib/hermes/types";

/**
 * `HermesMessage.kind` for a persisted resolved-confirmation audit card —
 * written by Core when the user approves/rejects a confirmation, so the
 * card survives a reload instead of living only in tab-local React state.
 * Content is the JSON snapshot Core serialized at resolve time.
 */
export const HERMES_CONFIRMATION_CARD_KIND = "confirmation_card";

export interface PersistedConfirmationCard {
  confirmation: HermesPendingConfirmation;
  resolution: {
    status: "approved" | "rejected" | "already_resolved";
    organizationId: string | null;
  };
}

function parseCoworkerRefs(value: unknown): HermesConfirmationCoworkerRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string") {
      return [];
    }
    return [
      {
        id: record.id,
        name: record.name,
        image: typeof record.image === "string" ? record.image : null,
      },
    ];
  });
}

function parseOrganizationRefs(
  value: unknown,
): HermesConfirmationOrganizationRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string") {
      return [];
    }
    return [
      {
        id: record.id,
        name: record.name,
        slug: typeof record.slug === "string" ? record.slug : null,
      },
    ];
  });
}

/**
 * Parses a persisted `confirmation_card` message body back into the shapes
 * the read-only ConfirmationCard renders. Lenient on optional fields,
 * strict on the ones the card can't render without — returns null (caller
 * drops the row) rather than surfacing raw JSON in the chat.
 */
export function parseConfirmationCardMessage(
  content: string,
): PersistedConfirmationCard | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const { confirmationId, toolName, summary, status } = record;
  if (typeof confirmationId !== "string" || confirmationId.length === 0) {
    return null;
  }
  if (typeof toolName !== "string" || toolName.length === 0) return null;
  if (typeof summary !== "string") return null;
  if (
    status !== "approved" &&
    status !== "rejected" &&
    status !== "already_resolved"
  ) {
    return null;
  }

  return {
    confirmation: {
      id: confirmationId,
      toolName,
      summary,
      createdAt:
        typeof record.confirmationCreatedAt === "string"
          ? record.confirmationCreatedAt
          : new Date(0).toISOString(),
      referencedCoworkers: parseCoworkerRefs(record.referencedCoworkers),
      referencedOrganizations: parseOrganizationRefs(
        record.referencedOrganizations,
      ),
      organizationId:
        typeof record.organizationId === "string"
          ? record.organizationId
          : null,
      organizationName:
        typeof record.organizationName === "string"
          ? record.organizationName
          : null,
    },
    resolution: {
      status,
      organizationId:
        typeof record.organizationId === "string"
          ? record.organizationId
          : null,
    },
  };
}
