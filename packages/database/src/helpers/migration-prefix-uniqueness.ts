/**
 * Prisma applies migrations by the 14-digit folder prefix, then the rest of
 * the name. Duplicate prefixes are collisions: apply order is no longer
 * uniquely determined by the timestamp.
 *
 * Two collisions already shipped and applied in production. They stay on disk
 * unchanged (renaming applied folders rewrites `_prisma_migrations`). This
 * allowlist is the exact folder sets, not a license to add a third.
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
