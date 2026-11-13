import type { SocialPost } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { SECTION_ORDER, SECTION_STATUSES, type SectionKey } from "./constants";

function timeOf(value: Date | null): number {
  return value ? new Date(value).getTime() : 0;
}

export function sectionOf(post: SocialPost): SectionKey | undefined {
  return SECTION_ORDER.find((section) =>
    SECTION_STATUSES[section].includes(post.status),
  );
}

export function sortSection(
  posts: SocialPost[],
  section: SectionKey,
): SocialPost[] {
  if (section === "attention") {
    return [...posts].sort(
      (a, b) =>
        timeOf(b.lastAttemptAt) - timeOf(a.lastAttemptAt) ||
        timeOf(b.scheduledAt) - timeOf(a.scheduledAt) ||
        b.id.localeCompare(a.id),
    );
  }
  return [...posts].sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
}

/** Same `yyyy-MM-dd` WorkspaceCalendar reads from `?date=`. */
export function calendarDateParam(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return `${values.year}-${values.month}-${values.day}`;
}

export function isRevisionConflict(error: ActionError): boolean {
  return error.kind === CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT;
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isTimeoutRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? error.name : undefined;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  return message.includes("timed out") || message.includes("timeout");
}

export function upsertPost(
  posts: SocialPost[],
  next: SocialPost,
): SocialPost[] {
  const index = posts.findIndex((post) => post.id === next.id);
  if (index === -1) return [next, ...posts];
  return posts.map((post) => (post.id === next.id ? next : post));
}

/**
 * A post with nothing it can do. A post whose write is still running offers
 * no action until Core answers, and every post of a CMO Project shows so.
 */
export function withoutActions(post: SocialPost): SocialPost {
  return {
    ...post,
    canEdit: false,
    canSchedule: false,
    canCancel: false,
    canPublishNow: false,
    canDuplicate: false,
    canApprove: false,
    canReject: false,
  };
}
