/**
 * Prisma applies migrations by the 14-digit folder prefix, then the rest of
 * the name. Duplicate prefixes are collisions: apply order is no longer
 * uniquely determined by the timestamp.
 *
 * The collisions below already shipped and applied to a deployed database.
 * They stay on disk unchanged: renaming an applied folder makes
 * `migrate deploy` treat it as a new migration and re-run its SQL, which
 * fails on the objects it already created and leaves the database in a
 * failed-migration state. Entries are the exact folder sets, and this is not
 * a license to land a new collision — pick a unique prefix instead.
 */

export const ALLOWED_DUPLICATE_MIGRATION_PREFIX_FOLDERS = {
  "20260203120000": [
    "20260203120000_add_task_transaction",
    "20260203120000_drop_transaction_included_fee",
  ],
  "20260802120000": [
    "20260802120000_chat_room_message_deleted_at",
    "20260802120000_chat_room_message_edited_at",
  ],
  "20260825140000": [
    "20260825140000_chat_room_channel_slug_namespace",
    "20260825140000_soko_bot_avatars_and_requester",
  ],
  // Calendar and Soko Bot landed the same hour on separate branches. Both are
  // applied in deployed environments, so renaming either would re-run its SQL
  // and wedge the database; the pair is recorded instead.
  "20260826140000": [
    "20260826140000_calendar_compatibility_foundation",
    "20260826140000_soko_bot_runtime_event",
  ],
  // Same story a day later: both branches picked the round hour. Ours is
  // already applied on the preview databases, so it keeps its name too.
  "20260828120000": [
    "20260828120000_org_less_matched_channels",
    "20260828120000_soko_bot_follow_board_default",
  ],
} as const satisfies Record<string, readonly string[]>;

export interface DuplicateMigrationPrefixViolation {
  prefix: string;
  folders: string[];
  reason: "unallowed" | "allowlist-mismatch";
}

const PREFIX = /^(\d{14})/;

export function findDuplicateMigrationPrefixViolations(
  folderNames: readonly string[],
  allowed: Readonly<
    Record<string, readonly string[]>
  > = ALLOWED_DUPLICATE_MIGRATION_PREFIX_FOLDERS,
): DuplicateMigrationPrefixViolation[] {
  const byPrefix = new Map<string, string[]>();
  for (const name of folderNames) {
    const prefix = PREFIX.exec(name)?.[1];
    if (!prefix) {
      continue;
    }
    const folders = byPrefix.get(prefix);
    if (folders) {
      folders.push(name);
    } else {
      byPrefix.set(prefix, [name]);
    }
  }

  const violations: DuplicateMigrationPrefixViolation[] = [];
  for (const [prefix, folders] of byPrefix) {
    if (folders.length < 2) {
      continue;
    }
    folders.sort();
    const expected = allowed[prefix];
    if (!expected) {
      violations.push({ prefix, folders, reason: "unallowed" });
      continue;
    }
    const expectedSorted = [...expected].sort();
    if (
      folders.length !== expectedSorted.length ||
      folders.some((folder, index) => folder !== expectedSorted[index])
    ) {
      violations.push({ prefix, folders, reason: "allowlist-mismatch" });
    }
  }
  return violations;
}
