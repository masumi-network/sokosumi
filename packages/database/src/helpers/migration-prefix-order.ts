/**
 * `migrate deploy` applies pending folders in name order and does not warn
 * when one sorts before the last applied migration. Each folder a branch adds
 * therefore needs a `YYYYMMDDHHMMSS_` stamp above the base's newest, or a
 * fresh database applies it in a different order than production. Such a
 * folder is not on the base yet, so production never applied it and it can
 * still take a fresh stamp. A folder the base has keeps its name: renaming
 * one re-runs its SQL, and deleting one leaves production with a migration
 * that fresh databases never get.
 *
 * The head must contain the base, as a pull request's merge commit contains
 * its first parent. Every stamped base folder missing from the head is then
 * one the branch removed. A base without a stamped folder is a wrong listing,
 * not a pass, so it throws.
 */

import { MIGRATION_PREFIX } from "./migration-prefix-uniqueness.js";

export interface MigrationOrderViolation {
  folder: string;
  reason: "not-after-base" | "unstamped" | "removed";
}

function stampOf(folder: string): string | undefined {
  return MIGRATION_PREFIX.exec(folder)?.[1];
}

export function newestMigration(
  folders: readonly string[],
): string | undefined {
  return folders
    .filter((folder) => stampOf(folder) !== undefined)
    .sort()
    .at(-1);
}

export function findMigrationOrderViolations(
  headFolders: readonly string[],
  baseFolders: readonly string[],
): MigrationOrderViolation[] {
  const newestOnBase = newestMigration(baseFolders);
  const newestStamp = newestOnBase && stampOf(newestOnBase);
  if (!newestStamp) {
    throw new Error("The base lists no stamped migration folder.");
  }

  const onBase = new Set(baseFolders);
  const onHead = new Set(headFolders);
  const added = headFolders
    .filter((folder) => !onBase.has(folder))
    .sort()
    .flatMap((folder): MigrationOrderViolation[] => {
      const stamp = stampOf(folder);
      if (stamp === undefined) {
        return [{ folder, reason: "unstamped" }];
      }
      return stamp <= newestStamp ? [{ folder, reason: "not-after-base" }] : [];
    });
  const removed = baseFolders
    .filter((folder) => !onHead.has(folder) && stampOf(folder) !== undefined)
    .sort()
    .map((folder): MigrationOrderViolation => ({ folder, reason: "removed" }));
  return [...added, ...removed];
}
