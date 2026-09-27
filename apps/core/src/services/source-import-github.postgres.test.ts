import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The GitHub-linked import, end to end against the real service.
 *
 * Everything here is real except the object store: a real PostgreSQL with
 * every migration applied, the real `importPendingResultBlobs`, the real
 * SSRF-safe fetch, and the real GitHub URLs from the bug report. Only
 * `@vercel/blob` is mocked, so the bytes the importer *would* have stored are
 * captured instead of written anywhere.
 *
 * This exists because the defect is not in a pure helper — it is in what the
 * importer downloads. A unit test with a stubbed `fetch` can only assert that
 * we asked for a different URL; this asserts that the URL we now ask for
 * returns the document instead of a web page.
 *
 * ## Why this file provisions its own database
 *
 * `importPendingResultBlobs` is the cron's entry point and takes no scope: it
 * selects **every** PENDING Blob and TaskFile in the database it is pointed
 * at. Run against a database holding anyone else's pending work, it would
 * import those rows too and write this file's mocked `blob.test` URLs over
 * them.
 *
 * Neither an opt-in flag nor a preflight count is enough. A flag says "the
 * operator meant to run DB tests", not "this database is disposable"; and a
 * count is a moment in time — another writer can enqueue immediately after
 * it, and the global worker would still pick that row up.
 *
 * So the suite does not share a database at all. It creates its own:
 *
 * 1. `FILES_IMPORT_TEST_DATABASE_URL` names a disposable, already-migrated
 *    *template*. `DATABASE_URL` is never read, so enabling the other opt-in
 *    Postgres suites cannot drag this one onto a shared database.
 * 2. The operator must separately affirm
 *    `FILES_IMPORT_TEST_DATABASE_DISPOSABLE=true`. No deployment, CI job or
 *    `.env` sets that, so it cannot be satisfied by accident.
 * 3. `beforeAll` issues `CREATE DATABASE ... TEMPLATE ...` and points
 *    `DATABASE_URL` at the copy. The database is seconds old and its name
 *    carries a fresh UUID, so no other process knows it exists, let alone
 *    writes to it. Isolation therefore holds for the whole run, not at one
 *    checkpoint.
 * 4. `afterAll` disconnects and drops it. A database left by a crashed run
 *    is inert and named `files_import_test_*`.
 *
 * The zero-pending assertion is kept as a cheap invariant: in a database
 * this suite just created it should be trivially true, and if it ever is
 * not, provisioning is broken and the unscoped worker is not safe to call.
 *
 * To run (the template must be disposable and yours):
 *
 *   FILES_IMPORT_TEST_DATABASE_URL=postgres://.../<migrated-template>  \
 *   FILES_IMPORT_TEST_DATABASE_DISPOSABLE=true                         \
 *   RUN_NETWORK_INTEGRATION_TESTS=true                                 \
 *   pnpm --filter @sokosumi/core exec vitest run                       \
 *     src/services/source-import-github.postgres.test.ts
 *
 * No credentials are used against GitHub: both URLs are public,
 * unauthenticated GETs.
 */

const templateDatabaseUrl = process.env.FILES_IMPORT_TEST_DATABASE_URL;
const enabled =
  process.env.RUN_NETWORK_INTEGRATION_TESTS === "true" &&
  process.env.FILES_IMPORT_TEST_DATABASE_DISPOSABLE === "true" &&
  Boolean(templateDatabaseUrl?.startsWith("postgres"));

/** Name of the throwaway copy this run created, while it exists. */
let provisionedDatabase: string | null = null;

function maintenanceUrl(source: string): string {
  const url = new URL(source);
  url.pathname = "/postgres";
  return url.toString();
}

/**
 * Copy the template into a database nobody else knows about.
 *
 * `CREATE DATABASE ... TEMPLATE ...` is a single statement and yields a
 * fully migrated, exclusively owned copy — which is what makes calling the
 * unscoped worker safe. The maintenance connection is closed immediately;
 * only Prisma talks to the copy afterwards.
 */
async function provisionIsolatedDatabase(source: string): Promise<string> {
  const { Client } = await import("pg");

  const template = decodeURIComponent(
    new URL(source).pathname.replace(/^\//, ""),
  );
  const name = `files_import_test_${randomUUID().replace(/-/g, "")}`;

  const admin = new Client({ connectionString: maintenanceUrl(source) });
  await admin.connect();
  try {
    // Sweep copies a previous run failed to drop. Vitest skips `afterAll`
    // when `beforeAll` throws, so an aborted run does leak one; the prefix
    // is only ever produced here, so this cannot remove anything else.
    const stale = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'files_import_test_%'",
    );
    for (const row of stale.rows) {
      await admin.query(
        `DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`,
      );
    }

    // Identifiers cannot be bound as parameters. Both are quoted; the name
    // is generated here and the template comes from the operator's own URL.
    await admin.query(
      `CREATE DATABASE "${name}" TEMPLATE "${template.replace(/"/g, '""')}"`,
    );
  } finally {
    await admin.end();
  }

  const target = new URL(source);
  target.pathname = `/${name}`;
  process.env.DATABASE_URL = target.toString();
  return name;
}

async function dropIsolatedDatabase(
  source: string,
  name: string,
): Promise<void> {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: maintenanceUrl(source) });
  await admin.connect();
  try {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    } catch {
      // Only if something is still attached. FORCE terminates those
      // backends, which the plain drop above avoids so that a tidy run
      // never has its own sockets killed underneath it.
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}

/** The exact URL from the report: a page *about* a Markdown file. */
const GITHUB_BLOB_PAGE =
  "https://github.com/masumi-network/sokosumi/blob/84d0a395284dd5dda58367470411a1e611c2c997/docs/image-studio/deployment.md";

// The importer refuses to run without a storage token. `@vercel/blob` is
// mocked below, so this value is never used against anything — it only gets
// the service past its configuration check. Set before the service is
// imported, because `getEnv()` caches on first call.
process.env.BLOB_READ_WRITE_TOKEN ??= "vercel_blob_rw_test_token";

/**
 * The suite uses its own Prisma client, not Core's singleton.
 *
 * Core builds its client around a `pg.Pool` it owns, and Prisma's
 * `$disconnect()` deliberately does not close a supplied pool — so its
 * sockets would still be attached to the throwaway database when the run
 * ends, and dropping it would have to kill them. Passing a connection string
 * instead makes Prisma own the pool, so disconnecting really closes it and
 * the database drops cleanly. It also means this suite can never touch
 * whatever database the singleton would have used.
 */
const prismaHolder = vi.hoisted(() => ({
  client: null as { $disconnect: () => Promise<void> } | null,
}));

vi.mock("@/lib/db/prisma", async () => {
  const { createPrismaClient } = await import("@sokosumi/database/client");
  // By the time anything imports this, `beforeAll` has provisioned the copy
  // and pointed DATABASE_URL at it.
  prismaHolder.client ??= createPrismaClient(
    process.env.DATABASE_URL as string,
  ) as unknown as { $disconnect: () => Promise<void> };
  return { default: prismaHolder.client };
});

interface CapturedUpload {
  pathname: string;
  bytes: Uint8Array;
  body: string;
  contentType: string;
}

const uploads: CapturedUpload[] = [];

vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    uploads.push({
      pathname,
      bytes,
      body: new TextDecoder().decode(bytes),
      contentType: file.type,
    });
    return { url: `https://blob.test/${pathname}` };
  },
  head: async () => ({ contentType: "text/markdown", size: 1234 }),
}));

/** `binary.jpg` in Schoonology/git-lfs-test, as GitHub's media host serves it. */
const LFS_MEDIA_BYTES = 620_773;
/** What `raw.githubusercontent.com` serves for the same path instead. */
const LFS_POINTER_BYTES = 131;

const suffix = randomUUID().slice(0, 8);
let userId = "";
let workspaceId = "";
let taskId = "";

/**
 * The blast radius of `importPendingResultBlobs` is exactly the set of
 * PENDING rows. Refusing to run while any exist that this suite did not
 * create is what makes the global selection safe here.
 */
export async function assertNoForeignPendingWork(
  ownedTaskFileIds: readonly string[] = [],
): Promise<void> {
  const { default: prisma } = await import("@/lib/db/prisma");

  const [pendingBlobs, pendingTaskFiles] = await Promise.all([
    prisma.blob.count({ where: { status: "PENDING" } }),
    prisma.taskFile.count({
      where: { status: "PENDING", id: { notIn: [...ownedTaskFileIds] } },
    }),
  ]);

  if (pendingBlobs > 0 || pendingTaskFiles > 0) {
    throw new Error(
      `Refusing to run: the target database holds pending import work this ` +
        `suite did not create (${pendingBlobs} blob, ${pendingTaskFiles} task ` +
        `file). importPendingResultBlobs has no scope and would import them ` +
        `with mocked storage URLs. Point FILES_IMPORT_TEST_DATABASE_URL at a ` +
        `disposable database.`,
    );
  }
}

describe.skipIf(!enabled)("GitHub-linked import against PostgreSQL", () => {
  beforeAll(async () => {
    // Before Prisma is imported: its client is a singleton built from the
    // environment on first import, so the copy must already exist and
    // DATABASE_URL must already point at it.
    provisionedDatabase = await provisionIsolatedDatabase(
      templateDatabaseUrl as string,
    );

    const { default: prisma } = await import("@/lib/db/prisma");

    await assertNoForeignPendingWork();

    const user = await prisma.user.create({
      data: {
        name: "Import fixture",
        email: `import-fixture-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    userId = user.id;

    const workspace = await prisma.workspace.create({
      data: { userId },
      select: { id: true },
    });
    workspaceId = workspace.id;

    const task = await prisma.task.create({
      data: {
        ownerId: userId,
        creatorUserId: userId,
        workspaceId,
        name: `Import fixture task ${suffix}`,
      },
      select: { id: true },
    });
    taskId = task.id;
  });

  afterAll(async () => {
    if (!enabled) return;
    const { default: prisma } = await import("@/lib/db/prisma");
    await prisma.taskFile.deleteMany({ where: { taskId } });
    await prisma.task.deleteMany({ where: { id: taskId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });

    // A failure part-way through must not leave pending work behind.
    await assertNoForeignPendingWork();

    // The copy exists only for this run.
    await prisma.$disconnect();
    if (provisionedDatabase) {
      await dropIsolatedDatabase(
        templateDatabaseUrl as string,
        provisionedDatabase,
      );
      provisionedDatabase = null;
    }
  });

  it("refuses to run when the database holds pending work it does not own", async () => {
    const { default: prisma } = await import("@/lib/db/prisma");

    const foreign = await prisma.taskFile.create({
      data: {
        taskId,
        name: "someone-elses-pending.pdf",
        sourceUrl: "https://example.invalid/someone-elses-pending.pdf",
        fileUrl: null,
        status: "PENDING",
        origin: "TASK_OUTPUT",
      },
      select: { id: true },
    });

    try {
      await expect(assertNoForeignPendingWork()).rejects.toThrow(
        /pending import work this suite did not create/,
      );
    } finally {
      await prisma.taskFile.delete({ where: { id: foreign.id } });
    }

    // And it is quiet again once nothing foreign is pending.
    await expect(assertNoForeignPendingWork()).resolves.toBeUndefined();
  });

  it("stores the Markdown file, not GitHub's page about it", async () => {
    const { default: prisma } = await import("@/lib/db/prisma");
    const { sourceImportSyncService } = await import(
      "./source-import-sync.service"
    );

    uploads.length = 0;

    const taskFile = await prisma.taskFile.create({
      data: {
        taskId,
        name: "deployment.md",
        sourceUrl: GITHUB_BLOB_PAGE,
        fileUrl: null,
        status: "PENDING",
        origin: "TASK_OUTPUT",
      },
      select: { id: true },
    });

    await sourceImportSyncService.importPendingResultBlobs({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    const settled = await prisma.taskFile.findUniqueOrThrow({
      where: { id: taskFile.id },
      select: { status: true, fileUrl: true, name: true },
    });

    expect(settled.status).toBe("READY");
    expect(settled.name).toBe("deployment.md");

    const stored = uploads.find((upload) =>
      upload.pathname.includes("deployment.md"),
    );
    expect(stored).toBeDefined();
    if (!stored) return;

    // The document the reader expects.
    expect(stored.body.startsWith("# Project image studio deployment")).toBe(
      true,
    );

    // None of what the report showed on screen.
    expect(stored.body).not.toContain("<!DOCTYPE html>");
    expect(stored.body).not.toContain("Navigation Menu");
    expect(stored.body).not.toContain("Skip to content");
    expect(stored.body).not.toContain("</html>");
  }, 60_000);

  it("refuses a page that is not a file, rather than storing it", async () => {
    const { default: prisma } = await import("@/lib/db/prisma");
    const { sourceImportSyncService } = await import(
      "./source-import-sync.service"
    );

    uploads.length = 0;

    // A GitHub *tree* page is not rewritten — it names a directory, not a
    // file — so it stays an HTML page arriving under a Markdown name. It
    // really does return 200 with `text/html`, which is what makes this
    // exercise the guard rather than ordinary 404 handling.
    const taskFile = await prisma.taskFile.create({
      data: {
        taskId,
        name: "tree-page.md",
        sourceUrl: "https://github.com/masumi-network/sokosumi/tree/main/docs",
        fileUrl: null,
        status: "PENDING",
        origin: "TASK_OUTPUT",
      },
      select: { id: true },
    });

    await sourceImportSyncService.importPendingResultBlobs({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    const settled = await prisma.taskFile.findUniqueOrThrow({
      where: { id: taskFile.id },
      select: { status: true },
    });

    expect(settled.status).toBe("FAILED");
    expect(uploads).toHaveLength(0);
  }, 60_000);

  /**
   * Git LFS is the reason a blob page resolves to GitHub's own `/raw/` route
   * rather than to `raw.githubusercontent.com`. A string assertion cannot
   * show the difference — only the bytes can, so this imports the real file
   * and checks them.
   */
  describe("Git LFS", () => {
    const LFS_RAW_ROUTE =
      "https://github.com/Schoonology/git-lfs-test/raw/master/binary.jpg";
    const LFS_BLOB_PAGE =
      "https://github.com/Schoonology/git-lfs-test/blob/master/binary.jpg";

    async function importOne(name: string, sourceUrl: string) {
      const { default: prisma } = await import("@/lib/db/prisma");
      const { sourceImportSyncService } = await import(
        "./source-import-sync.service"
      );

      uploads.length = 0;

      const taskFile = await prisma.taskFile.create({
        data: {
          taskId,
          name,
          sourceUrl,
          fileUrl: null,
          status: "PENDING",
          origin: "TASK_OUTPUT",
        },
        select: { id: true },
      });

      await sourceImportSyncService.importPendingResultBlobs({
        abortSignal: new AbortController().signal,
        deadlineMs: Date.now() + 60_000,
        shouldContinue: () => true,
      });

      const settled = await prisma.taskFile.findUniqueOrThrow({
        where: { id: taskFile.id },
        select: { status: true },
      });

      return { settled, stored: uploads[0] };
    }

    function expectRealJpeg(stored: CapturedUpload | undefined) {
      expect(stored).toBeDefined();
      if (!stored) return;

      // JPEG magic. The LFS pointer is UTF-8 text beginning "version https".
      expect([...stored.bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      expect(stored.bytes.byteLength).toBe(LFS_MEDIA_BYTES);
      expect(stored.bytes.byteLength).not.toBe(LFS_POINTER_BYTES);
      expect(stored.body.startsWith("version https://git-lfs.github.com")).toBe(
        false,
      );
    }

    it("imports the media for an existing /raw/ link, not the pointer", async () => {
      const { settled, stored } = await importOne(
        "binary-raw.jpg",
        LFS_RAW_ROUTE,
      );
      expect(settled.status).toBe("READY");
      expectRealJpeg(stored);
    }, 120_000);

    it("imports the media for a blob page too", async () => {
      const { settled, stored } = await importOne(
        "binary-blob.jpg",
        LFS_BLOB_PAGE,
      );
      expect(settled.status).toBe("READY");
      expectRealJpeg(stored);
    }, 120_000);

    /**
     * The non-equivalence itself, as executable fact: the pointer host does
     * not serve the file. This is what an earlier revision of the helper
     * produced by rewriting `/raw/` links, and it is why it no longer does.
     *
     * It also records a real limit. A job that emits the
     * `raw.githubusercontent.com` URL itself still gets the pointer, because
     * that URL is passed through as the job wrote it — guessing that a
     * caller meant a different host is not this importer's decision.
     */
    it("shows the pointer host is not equivalent to the media route", async () => {
      const { settled, stored } = await importOne(
        "binary-pointer.jpg",
        "https://raw.githubusercontent.com/Schoonology/git-lfs-test/master/binary.jpg",
      );

      expect(settled.status).toBe("READY");
      expect(stored).toBeDefined();
      if (!stored) return;

      expect(stored.bytes.byteLength).toBe(LFS_POINTER_BYTES);
      expect(stored.body.startsWith("version https://git-lfs.github.com")).toBe(
        true,
      );
      expect([...stored.bytes.slice(0, 3)]).not.toEqual([0xff, 0xd8, 0xff]);
    }, 120_000);
  });
});
