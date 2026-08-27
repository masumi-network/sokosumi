import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_DUPLICATE_MIGRATION_PREFIX_FOLDERS,
  findDuplicateMigrationPrefixViolations,
} from "./migration-prefix-uniqueness.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = join(packageRoot, "prisma/migrations");

function migrationFolders(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe("findDuplicateMigrationPrefixViolations", () => {
  it("accepts unique prefixes", () => {
    expect(
      findDuplicateMigrationPrefixViolations([
        "20260101120000_one",
        "20260102120000_two",
      ]),
    ).toEqual([]);
  });

  it("accepts the allowlisted historical pairs", () => {
    expect(
      findDuplicateMigrationPrefixViolations([
        "20260203120000_add_task_transaction",
        "20260203120000_drop_transaction_included_fee",
        "20260802120000_chat_room_message_deleted_at",
        "20260802120000_chat_room_message_edited_at",
      ]),
    ).toEqual([]);
  });

  it("rejects a new duplicate prefix", () => {
    expect(
      findDuplicateMigrationPrefixViolations([
        "20260819130000_task_x402_payment",
        "20260819130000_oops",
      ]),
    ).toEqual([
      {
        prefix: "20260819130000",
        folders: ["20260819130000_oops", "20260819130000_task_x402_payment"],
        reason: "unallowed",
      },
    ]);
  });

  it("rejects a third folder on an allowlisted prefix", () => {
    expect(
      findDuplicateMigrationPrefixViolations([
        "20260203120000_add_task_transaction",
        "20260203120000_drop_transaction_included_fee",
        "20260203120000_something_else",
      ]),
    ).toEqual([
      {
        prefix: "20260203120000",
        folders: [
          "20260203120000_add_task_transaction",
          "20260203120000_drop_transaction_included_fee",
          "20260203120000_something_else",
        ],
        reason: "allowlist-mismatch",
      },
    ]);
  });

  it("rejects an allowlisted prefix whose folder names drifted", () => {
    expect(
      findDuplicateMigrationPrefixViolations([
        "20260802120000_chat_room_message_deleted_at",
        "20260802120000_renamed",
      ]),
    ).toEqual([
      {
        prefix: "20260802120000",
        folders: [
          "20260802120000_chat_room_message_deleted_at",
          "20260802120000_renamed",
        ],
        reason: "allowlist-mismatch",
      },
    ]);
  });
});

describe("prisma/migrations prefixes", () => {
  it("has no unallowed duplicate prefixes", () => {
    expect(findDuplicateMigrationPrefixViolations(migrationFolders())).toEqual(
      [],
    );
  });

  it("still contains every allowlisted collision folder", () => {
    const folders = new Set(migrationFolders());
    for (const expected of Object.values(
      ALLOWED_DUPLICATE_MIGRATION_PREFIX_FOLDERS,
    ).flat()) {
      expect(folders.has(expected), expected).toBe(true);
    }
  });
});
