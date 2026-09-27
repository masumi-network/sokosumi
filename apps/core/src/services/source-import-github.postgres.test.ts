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
 * Doubly opt-in, because it needs a database *and* the public internet:
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true RUN_NETWORK_INTEGRATION_TESTS=true \
 *   DATABASE_URL=postgres://… pnpm --filter @sokosumi/core exec vitest run \
 *   src/services/source-import-github.postgres.test.ts
 *
 * No credentials are used: both URLs are public, unauthenticated GETs.
 */

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.RUN_NETWORK_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

/** The exact URL from the report: a page *about* a Markdown file. */
const GITHUB_BLOB_PAGE =
  "https://github.com/masumi-network/sokosumi/blob/84d0a395284dd5dda58367470411a1e611c2c997/docs/image-studio/deployment.md";

// The importer refuses to run without a storage token. `@vercel/blob` is
// mocked below, so this value is never used against anything — it only gets
// the service past its configuration check. Set before the service is
// imported, because `getEnv()` caches on first call.
process.env.BLOB_READ_WRITE_TOKEN ??= "vercel_blob_rw_test_token";

const uploads: { pathname: string; body: string; contentType: string }[] = [];

vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, file: File) => {
    uploads.push({
      pathname,
      body: await file.text(),
      contentType: file.type,
    });
    return { url: `https://blob.test/${pathname}` };
  },
  head: async () => ({ contentType: "text/markdown", size: 1234 }),
}));

const suffix = randomUUID().slice(0, 8);
let userId = "";
let workspaceId = "";
let taskId = "";

describe.skipIf(!enabled)("GitHub-linked import against PostgreSQL", () => {
  beforeAll(async () => {
    const { default: prisma } = await import("@/lib/db/prisma");

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
});
