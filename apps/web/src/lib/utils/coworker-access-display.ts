import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";

export interface CoworkerAccessEntry {
  access: CoworkerWorkspaceAccess;
  coworkerName: string;
  coworkerSlug: string | null;
}

export type CoworkerAccessStatusMessageKey =
  | "statusPending"
  | "statusGranted"
  | "statusDenied"
  | "statusRevoked";

export function coworkerAccessStatusMessageKey(
  status: CoworkerWorkspaceAccess["status"],
): CoworkerAccessStatusMessageKey {
  switch (status) {
    case "PENDING":
      return "statusPending";
    case "GRANTED":
      return "statusGranted";
    case "DENIED":
      return "statusDenied";
    case "REVOKED":
      return "statusRevoked";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Map Core access rows (already include coworker display fields) into UI entries. */
export function toCoworkerAccessEntries(
  rows: CoworkerWorkspaceAccess[],
): CoworkerAccessEntry[] {
  return rows.map((access) => ({
    access,
    coworkerName: access.coworkerName,
    coworkerSlug: access.coworkerSlug ?? null,
  }));
}

export function isAccessPending(entry: CoworkerAccessEntry): boolean {
  return entry.access.status === "PENDING";
}

export function isAccessGranted(entry: CoworkerAccessEntry): boolean {
  return entry.access.status === "GRANTED";
}

export function isAccessDeniedOrRevoked(entry: CoworkerAccessEntry): boolean {
  return entry.access.status === "DENIED" || entry.access.status === "REVOKED";
}
