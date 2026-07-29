/**
 * Lightweight schedule detection shared by Core access control and web UI.
 *
 * Structural metadata check only (version + mode). Full field validation stays
 * in Core's Zod `parseTaskScheduleMetadata` for write/sync paths.
 */

function hasTaskScheduleMetadataShape(
  metadata: string | null | undefined,
): boolean {
  if (!metadata) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== "object") {
      return false;
    }

    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) {
      return false;
    }

    return record.mode === "once" || record.mode === "recurring";
  } catch {
    return false;
  }
}

/**
 * Whether a task currently has an active schedule (metadata or nextRunAt).
 *
 * Accepts `Date` (Prisma) or ISO string (API DTOs).
 */
export function hasActiveTaskSchedule(
  metadata: string | null | undefined,
  nextRunAt: Date | string | null | undefined,
): boolean {
  return hasTaskScheduleMetadataShape(metadata) || Boolean(nextRunAt);
}
