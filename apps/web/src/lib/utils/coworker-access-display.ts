import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";

export interface CoworkerAccessEntry {
  access: CoworkerWorkspaceAccess;
  coworkerName: string;
  coworkerSlug: string | null;
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
