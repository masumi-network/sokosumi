import type { SocialPostMediaRef } from "@sokosumi/core-client";

const PREFIX = "sokosumi.social-compose.";

export interface SocialComposePrefill {
  media: SocialPostMediaRef[];
  text?: string;
}

function storageKey(projectId: string): string {
  return `${PREFIX}${projectId}`;
}

function isMediaRef(value: unknown): value is SocialPostMediaRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.pathname === "string" &&
    typeof ref.fileUrl === "string" &&
    typeof ref.name === "string" &&
    typeof ref.size === "number" &&
    typeof ref.mimeType === "string" &&
    (ref.kind === "image" || ref.kind === "gif" || ref.kind === "video")
  );
}

function parsePrefill(raw: string): SocialComposePrefill | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.media) || !record.media.every(isMediaRef)) {
      return null;
    }
    const text = typeof record.text === "string" ? record.text : undefined;
    return text === undefined
      ? { media: record.media }
      : { media: record.media, text };
  } catch {
    return null;
  }
}

export function writeSocialComposePrefill(
  projectId: string,
  prefill: SocialComposePrefill,
): void {
  sessionStorage.setItem(storageKey(projectId), JSON.stringify(prefill));
}

export function peekSocialComposePrefill(
  projectId: string,
): SocialComposePrefill | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(storageKey(projectId));
  if (!raw) return null;
  return parsePrefill(raw);
}

export function clearSocialComposePrefill(projectId: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(storageKey(projectId));
}
