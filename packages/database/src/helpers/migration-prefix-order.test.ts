import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findMigrationOrderViolations,
  newestMigration,
} from "./migration-prefix-order.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = join(packageRoot, "prisma/migrations");
const baseRefVariable = "MIGRATION_ORDER_BASE_REF";
const baseRef = process.env[baseRefVariable];

// `./` resolves the path from `cwd`. `--full-tree` stops ls-tree from also
// filtering the listing by `cwd`, which would empty it. `-d` keeps folders
// only, as the head listing does. `-z` prints each name as it is; without
// it, git quotes non-ASCII names.
function listMigrationFolders(
  ref: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return execFileSync(
    "git",
    [
      "ls-tree",
      "-d",
      "-z",
      "--full-tree",
      "--name-only",
      `${ref}:./prisma/migrations`,
    ],
    { cwd, env, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
}

describe("findMigrationOrderViolations", () => {
  const base = [
    "20260101120000_one",
    "20260102120000_two",
    "migration_lock.toml",
  ];

  it("accepts a new folder stamped after the newest base folder", () => {
    expect(
      findMigrationOrderViolations([...base, "20260103120000_three"], base),
    ).toEqual([]);
    expect(
      findMigrationOrderViolations([...base, "20260102120001_same_day"], base),
    ).toEqual([]);
  });

  it("ignores folders already on the base, however old", () => {
    expect(findMigrationOrderViolations(base, base)).toEqual([]);
  });

  it("rejects a new folder stamped before the newest base folder", () => {
    expect(
      findMigrationOrderViolations([...base, "20260101130000_late"], base),
    ).toEqual([{ folder: "20260101130000_late", reason: "not-after-base" }]);
  });

  it("rejects a new folder that reuses the newest base stamp", () => {
    expect(
      findMigrationOrderViolations([...base, "20260102120000_twin"], base),
    ).toEqual([{ folder: "20260102120000_twin", reason: "not-after-base" }]);
  });

  it("finds the newest base folder whatever the input order", () => {
    const unsorted = [
      "20260102120000_two",
      "migration_lock.toml",
      "20260101120000_one",
    ];
    expect(
      findMigrationOrderViolations(
        [...unsorted, "20260101130000_late"],
        unsorted,
      ),
    ).toEqual([{ folder: "20260101130000_late", reason: "not-after-base" }]);
  });

  it("rejects a new folder without a 14-digit stamp and underscore", () => {
    expect(
      findMigrationOrderViolations(
        [
          ...base,
          "notes",
          "2026010312000a_letter",
          "202601031200001_long",
          "2026-01-03_dashes",
        ],
        base,
      ),
    ).toEqual([
      { folder: "2026-01-03_dashes", reason: "unstamped" },
      { folder: "202601031200001_long", reason: "unstamped" },
      { folder: "2026010312000a_letter", reason: "unstamped" },
      { folder: "notes", reason: "unstamped" },
    ]);
  });

  it("rejects renaming a base folder to a fresh stamp", () => {
    expect(
      findMigrationOrderViolations(
        ["20260102120000_two", "20260103120000_one"],
        base,
      ),
    ).toEqual([{ folder: "20260101120000_one", reason: "removed" }]);
  });

  it("rejects deleting or renaming the newest base folder", () => {
    const newestRemoved = [{ folder: "20260102120000_two", reason: "removed" }];
    expect(findMigrationOrderViolations(["20260101120000_one"], base)).toEqual(
      newestRemoved,
    );
    expect(
      findMigrationOrderViolations(
        ["20260101120000_one", "20260103120000_two"],
        base,
      ),
    ).toEqual(newestRemoved);
  });

  it("throws when the base lists no stamped folder", () => {
    for (const emptyBase of [[], ["migration_lock.toml"]]) {
      expect(() =>
        findMigrationOrderViolations(["20260101120000_one"], emptyBase),
      ).toThrow("The base lists no stamped migration folder.");
    }
  });

  it("lists every stamped base folder as removed from an empty head, in name order", () => {
    expect(findMigrationOrderViolations([], [...base].reverse())).toEqual([
      { folder: "20260101120000_one", reason: "removed" },
      { folder: "20260102120000_two", reason: "removed" },
    ]);
  });
});

describe("newestMigration", () => {
  it("skips entries without a stamp", () => {
    expect(newestMigration(["migration_lock.toml", "20260101120000_one"])).toBe(
      "20260101120000_one",
    );
    expect(newestMigration(["migration_lock.toml"])).toBeUndefined();
  });
});

// scripts/ci/__tests__/migration-order-step.test.mjs checks the rest of the
// step. This test fails when the name read below drifts from the one CI sets.
describe("the Test Packages step", () => {
  it("runs this file with the base ref set", () => {
    const workflow = readFileSync(
      join(packageRoot, "../../.github/workflows/ci.yml"),
      "utf8",
    );
    const step = workflow
      .split("\n")
      .find((line) => line.trimStart().startsWith(`${baseRefVariable}=`));
    expect(step).toContain("pnpm --filter @sokosumi/database");
    expect(step).toContain(
      relative(packageRoot, fileURLToPath(import.meta.url)),
    );
  });
});

describe("listMigrationFolders", () => {
  // A git hook exports GIT_DIR and GIT_INDEX_FILE, which would point these
  // commands at the caller's repo. The caller's config can also ignore or
  // sign files. So git runs here without any of that. The bogus GIT_DIR
  // makes this test fail if the filter ever lets one through.
  const callerEnv = { ...process.env, GIT_DIR: "/nonexistent/.git" };
  const env = {
    ...Object.fromEntries(
      Object.entries(callerEnv).filter(([key]) => !key.startsWith("GIT_")),
    ),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };

  it("skips files, so a stamped file on the base is not a removal", () => {
    const repo = mkdtempSync(join(tmpdir(), "migration-order-"));
    try {
      const migrations = join(repo, "prisma/migrations");
      mkdirSync(join(migrations, "20260101120000_one"), { recursive: true });
      writeFileSync(join(migrations, "20260101120000_one/migration.sql"), "");
      writeFileSync(join(migrations, "20260102120000_file.sql"), "");
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: repo, env, stdio: "ignore" });
      git("init", "-q");
      // `-f`: git reads a default ignore file even with its config off.
      git("add", "-f", ".");
      git("commit", "-q", "-m", "base");
      expect(listMigrationFolders("HEAD", repo, env)).toEqual([
        "20260101120000_one",
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// CI sets MIGRATION_ORDER_BASE_REF to the PR merge commit's first parent, or
// on workflow_dispatch to the default branch tip. Locally, run `git fetch
// origin main` and merge `origin/main`. Then run
// `MIGRATION_ORDER_BASE_REF=origin/main pnpm --filter @sokosumi/database
// exec vitest run src/helpers/migration-prefix-order.test.ts`. The head side
// reads the working tree, so remove untracked migration folders first.
describe.skipIf(!baseRef)("prisma/migrations against the base ref", () => {
  it("adds only stamped folders after the base's newest and keeps the rest", () => {
    const head = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const base = listMigrationFolders(baseRef ?? "", packageRoot);
    const newestOnBase = newestMigration(base);
    expect(newestOnBase, `${baseRef} lists no migrations`).toBeDefined();

    expect(
      findMigrationOrderViolations(head, base),
      [
        `Newest migration on the base (${baseRef}): ${newestOnBase}.`,
        "not-after-base, unstamped: rename the folder to <stamp>_<name>, with a 14-digit stamp above that newest one. `date -u +%Y%m%d%H%M%S` gives one when the clock is past it.",
        "removed: restore the folder. Applied migrations keep their names. To undo one, add a new migration.",
        "A Preview that applied the old name needs `/reset-db <network>` on the PR.",
      ].join("\n"),
    ).toEqual([]);
  });
});
