import { randomUUID } from "node:crypto";

import { FileIndexJobPipeline, FileLabelKind } from "@sokosumi/database";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Who may put bytes on a Drive pathname, through the real routes, the real
 * catalog and a fake Blob store.
 *
 * - An upload grant writes only its catalog version's staging key. Its bytes
 *   reach a Drive pathname only when finalize promotes that version.
 * - A rename or move takes its destination in the catalog before any bytes
 *   move, so a name a pending upload holds stops it with the source intact.
 * - A late write from a grant whose document was deleted, renamed or
 *   replaced lands on a key nothing lists or promotes.
 *
 * A copy (labels pinned empty) is the upload these guarantees protect most:
 * its bytes must stay its own, and no step may ask the paid label model.
 */

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

interface FakeObject {
  body: string;
  contentType: string;
  uploadedAt: Date;
  etag: string;
}

type Hook = () => Promise<void> | void;

/**
 * One public Blob store: no overwrite unless asked, ETags per write kept
 * through a rename, conditional deletes, and hooks that run inside a call
 * to interleave another request or fail after the work is done.
 */
const fake = vi.hoisted(() => {
  class BlobNotFoundError extends Error {}
  class BlobPreconditionFailedError extends Error {}
  const objects = new Map<string, FakeObject>();
  const hooks: {
    beforeRename?: Hook;
    afterRename?: Hook;
    beforeDel?: Hook;
    /** Runs after a head of this pathname read the object, before it returns. */
    afterHead?: { pathname: string; skip: number; run: Hook };
  } = {};
  let writes = 0;
  const meta = (pathname: string, object: FakeObject) => ({
    pathname,
    url: `https://blob.test/${pathname}`,
    downloadUrl: `https://blob.test/${pathname}`,
    size: object.body.length,
    contentType: object.contentType,
    uploadedAt: object.uploadedAt,
    cacheControl: "public, max-age=60",
    contentDisposition: "",
    etag: object.etag,
  });
  const write = (
    pathname: string,
    body: string,
    contentType: string,
    allowOverwrite = false,
  ) => {
    if (objects.has(pathname) && !allowOverwrite)
      throw new Error("Vercel Blob: This blob already exists");
    writes += 1;
    objects.set(pathname, {
      body,
      contentType,
      uploadedAt: new Date(),
      etag: `"w${writes}"`,
    });
  };
  /** Every mutation, so a test can assert none happened. */
  const mutations: string[] = [];
  return {
    objects,
    hooks,
    mutations,
    write,
    module: {
      BlobNotFoundError,
      BlobPreconditionFailedError,
      head: async (pathname: string) => {
        const object = objects.get(pathname);
        if (!object) throw new BlobNotFoundError("not found");
        const result = meta(pathname, object);
        const hook = hooks.afterHead;
        if (hook?.pathname === pathname) {
          if (hook.skip > 0) hook.skip -= 1;
          else {
            delete hooks.afterHead;
            await hook.run();
          }
        }
        return result;
      },
      list: async (options: { prefix?: string }) => ({
        blobs: [...objects.entries()]
          .filter(([pathname]) => pathname.startsWith(options.prefix ?? ""))
          .map(([pathname, object]) => meta(pathname, object)),
        folders: [],
        hasMore: false,
      }),
      get: async (pathname: string) => {
        const object = objects.get(pathname);
        if (!object) throw new BlobNotFoundError("not found");
        return {
          statusCode: 200,
          stream: object.body,
          blob: meta(pathname, object),
          headers: new Headers(),
        };
      },
      put: async (
        pathname: string,
        body: string,
        options: { contentType?: string; allowOverwrite?: boolean },
      ) => {
        mutations.push(`put ${pathname}`);
        write(
          pathname,
          String(body),
          options.contentType ?? "application/octet-stream",
          options.allowOverwrite,
        );
        return { url: `https://blob.test/${pathname}`, pathname };
      },
      rename: async (from: string, to: string) => {
        mutations.push(`rename ${from} ${to}`);
        await hooks.beforeRename?.();
        const object = objects.get(from);
        if (!object) throw new BlobNotFoundError("not found");
        if (objects.has(to))
          throw new Error("Vercel Blob: This blob already exists");
        objects.delete(from);
        writes += 1;
        objects.set(to, { ...object, etag: `"w${writes}"` });
        await hooks.afterRename?.();
        return { url: `https://blob.test/${to}`, pathname: to };
      },
      del: async (
        pathnames: string | string[],
        options: { ifMatch?: string } = {},
      ) => {
        mutations.push(`del ${[pathnames].flat().join(",")}`);
        await hooks.beforeDel?.();
        for (const pathname of [pathnames].flat()) {
          const object = objects.get(pathname);
          if (options.ifMatch && object && object.etag !== options.ifMatch)
            throw new BlobPreconditionFailedError("etag changed");
          objects.delete(pathname);
        }
      },
      issueSignedToken: async () => "signed",
      presignUrl: async (_token: string, options: { pathname: string }) => ({
        presignedUrl: `fake-put://${options.pathname}`,
      }),
    },
  };
});
vi.mock("@vercel/blob", () => fake.module);

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: "public-token",
      DATA_ROOM_BLOB_READ_WRITE_TOKEN: undefined,
    }),
  };
});

const owner = vi.hoisted(() => ({ userId: "", workspaceId: "" }));
const access = vi.hoisted(() => ({ requireDriveFileAccess: vi.fn() }));
vi.mock("@/helpers/drive-file-access", () => ({
  drivePathOf: (pathname: string) => pathname.split("/").slice(3).join("/"),
  requireDriveFileAccess: access.requireDriveFileAccess,
  requireUserDriveFileUploadAccess: vi.fn(),
  requireOrganizationDriveFileUploadAccess: vi.fn(),
}));
vi.mock("@/helpers/drive-tasks-workspace", () => ({
  resolveDriveTasksWorkspace: vi.fn(async () => ({
    workspaceId: owner.workspaceId,
  })),
}));
vi.mock("@/helpers/file-workspace", () => ({
  resolveFileRequestContext: vi.fn(async () => ({
    workspaceId: owner.workspaceId,
    scope: "user",
    ownerId: owner.userId,
  })),
}));
vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: vi.fn(),
  nudgeFileExtraction: vi.fn(),
}));

import prisma from "@/lib/db/prisma";
import {
  enqueueFileIndexJob,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import type { JevLabelEvaluator } from "@/lib/files/jev-client";
import { backfillDriveStore } from "@/services/file-backfill.service";
import { runSuggestionJob } from "@/services/file-suggestions.service";

import mountDelete from "./files/[id]/delete.js";
import mountRename from "./files/[id]/patch.js";
import mountFinalize from "./files/finalize.js";
import mountMove from "./files/move.js";
import mountMint from "./files/post.js";
import mountFolderRename from "./folders/rename.js";

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);

/** A label model that counts how often it is asked and declines. */
const evaluator = {
  calls: 0,
  async evaluateLabels() {
    evaluator.calls += 1;
    return {
      ok: true,
      chosen: [],
      reason: null,
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      costUsd: "0.0001",
      generationId: "gen-test",
    };
  },
};

const app = new OpenAPIHonoWithAuth();
app.onError(errorHandler);
app.use("*", async (c, next) => {
  const auth: AuthenticationContext = {
    actor: "user",
    userId: owner.userId,
    organizationId: null,
    role: "user",
    authenticationMethod: "session",
  };
  c.set("authContext", auth);
  await next();
});
mountMint(app);
mountFinalize(app);
mountRename(app);
mountDelete(app);
mountMove(app);
const folders = new OpenAPIHonoWithAuth();
folders.onError(errorHandler);
folders.use("*", async (c, next) => {
  c.set("authContext", {
    actor: "user",
    userId: owner.userId,
    organizationId: null,
    role: "user",
    authenticationMethod: "session",
  } satisfies AuthenticationContext);
  await next();
});
mountFolderRename(folders);

function call(method: string, path: string, body: unknown, on = app) {
  return on.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface Session {
  uploadUrl: string;
  pathname: string;
  attemptId?: string;
}

interface MintOptions {
  pinLabelsEmpty?: boolean;
  folder?: string;
  /** False: the released flow an old Web bundle uses. */
  staged?: boolean;
}

function requestMint(filename: string, options: MintOptions = {}) {
  const { staged = true, ...rest } = options;
  return call("POST", "/", {
    filename,
    contentType: "text/markdown",
    size: 64,
    scope: "me",
    ...(staged ? { staged: true } : {}),
    ...rest,
  });
}

async function mint(
  filename: string,
  options: MintOptions = {},
): Promise<Session> {
  const response = await requestMint(filename, options);
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

/** The browser's PUT: writes wherever the grant points, nothing else. */
function put(session: Session, body: string) {
  fake.write(
    session.uploadUrl.replace("fake-put://", ""),
    body,
    "text/markdown",
  );
}

function finalize(session: { pathname: string; attemptId?: string }) {
  return call("POST", "/finalize", {
    scope: "me",
    pathname: session.pathname,
    ...(session.attemptId ? { attemptId: session.attemptId } : {}),
  });
}

async function upload(
  filename: string,
  body: string,
  options: MintOptions = {},
) {
  const session = await mint(filename, options);
  put(session, body);
  const response = await finalize(session);
  expect(response.status).toBe(200);
  return { session, resourceId: (await response.json()).data.resourceId };
}

const at = (pathname: string) => fake.objects.get(pathname)?.body;
const drivePath = (name: string) => `drive/users/${owner.userId}/${name}`;
const baseName = (pathname: string) => pathname.split("/").at(-1) as string;

function row(pathname: string) {
  return prisma.fileResource.findFirst({
    where: { workspaceId: owner.workspaceId, sourceId: pathname },
    select: { id: true, lifecycle: true },
  });
}

function pins(resourceId: string) {
  return prisma.fileFieldOverride.count({
    where: { resourceId, labelId: null, decision: "PIN" },
  });
}

/** Fake evaluator calls for one document's queued suggestion work. */
async function suggestionsAsked(resourceId: string) {
  await prisma.fileVersion.updateMany({
    where: { resourceId },
    data: { extractionState: "UNSUPPORTED" },
  });
  const { contentRevision } = await prisma.fileResource.findUniqueOrThrow({
    where: { id: resourceId },
    select: { contentRevision: true },
  });
  await enqueueFileIndexJob({
    resourceId,
    pipeline: FileIndexJobPipeline.SUGGEST,
    contentRevision,
    runAfter: new Date(Date.now() - 1_000),
  });
  let asked = 0;
  for (;;) {
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.SUGGEST,
    });
    if (!leased) break;
    const before = evaluator.calls;
    await runSuggestionJob(leased, {
      evaluator: evaluator as unknown as JevLabelEvaluator,
      configured: () => true,
    });
    if (leased.job.resourceId === resourceId) asked += evaluator.calls - before;
  }
  return asked;
}

describe.skipIf(!enabled)("Drive pathname ownership", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Drive owner",
        email: `drive-owner-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    owner.userId = user.id;
    const workspace = await prisma.workspace.create({
      data: { userId: user.id },
      select: { id: true },
    });
    owner.workspaceId = workspace.id;
    // A vocabulary exists, so an unpinned document would go to the model.
    await prisma.workspaceLabel.create({
      data: {
        workspaceId: workspace.id,
        kind: FileLabelKind.TAG,
        displayName: "Briefs",
        normalizedName: "briefs",
      },
    });
  });

  beforeEach(() => {
    fake.objects.clear();
    fake.mutations.length = 0;
    for (const key of Object.keys(fake.hooks) as (keyof typeof fake.hooks)[])
      delete fake.hooks[key];
    access.requireDriveFileAccess.mockReset();
    access.requireDriveFileAccess.mockResolvedValue({ hiddenRoomFolders: [] });
  });

  afterAll(async () => {
    if (!enabled) return;
    const where = { workspaceId: owner.workspaceId };
    await prisma.fileResource.deleteMany({ where });
    await prisma.fileEvidenceScope.deleteMany({ where });
    await prisma.workspaceLabel.deleteMany({ where });
    await prisma.workspace.deleteMany({ where: { id: owner.workspaceId } });
    await prisma.user.deleteMany({ where: { id: owner.userId } });
  });

  it("puts an upload in Drive only when finalize promotes its own staged bytes", async () => {
    const session = await mint("plan.md");
    put(session, "plan v1");

    expect(session.uploadUrl).toMatch(/^fake-put:\/\/drive-staging\//);
    expect(at(session.pathname)).toBeUndefined();

    const response = await finalize(session);

    expect(response.status).toBe(200);
    expect((await response.json()).data.fileUrl).toBe(
      `https://blob.test/${session.pathname}`,
    );
    expect(at(session.pathname)).toBe("plan v1");
    expect(
      [...fake.objects.keys()].filter((key) => key.startsWith("drive-staging")),
    ).toEqual([]);
    expect(await row(session.pathname)).toMatchObject({ lifecycle: "ACTIVE" });
  });

  it("stops a rename onto a pending copy's name before any bytes move", async () => {
    const copy = await mint("weekly.md", { pinLabelsEmpty: true });
    const { resourceId: otherId } = await upload("other.md", "other bytes");

    const renamed = await call("PATCH", "/rename", {
      oldPathname: drivePath("other.md"),
      newFilename: baseName(copy.pathname),
    });

    expect(renamed.status).toBe(409);
    expect(at(drivePath("other.md"))).toBe("other bytes");
    expect(await row(drivePath("other.md"))).toMatchObject({ id: otherId });
    expect(at(copy.pathname)).toBeUndefined();

    put(copy, "copy bytes");
    const finalized = await finalize(copy);
    expect(finalized.status).toBe(200);
    const { resourceId } = (await finalized.json()).data;
    expect(at(copy.pathname)).toBe("copy bytes");
    expect(await pins(resourceId)).toBe(2);
    expect(await suggestionsAsked(resourceId)).toBe(0);
  });

  it("stops a rename of a file the catalog never saw onto a pending name", async () => {
    const copy = await mint("loose.md", { pinLabelsEmpty: true });
    fake.write(drivePath("legacy.md"), "legacy bytes", "text/markdown");

    const renamed = await call("PATCH", "/rename", {
      oldPathname: drivePath("legacy.md"),
      newFilename: baseName(copy.pathname),
    });

    expect(renamed.status).toBe(409);
    expect(at(drivePath("legacy.md"))).toBe("legacy bytes");
    expect(at(copy.pathname)).toBeUndefined();
  });

  it("stops a move into a folder onto a pending upload's name", async () => {
    const pending = await mint("brief.md", { folder: "inbox" });
    await upload("brief.md", "root brief");

    const moved = await call("PATCH", "/move", {
      itemType: "file",
      sourcePathname: drivePath("brief.md"),
      targetFolderPath: "inbox",
      scope: "me",
    });

    expect(moved.status).toBe(409);
    expect(at(drivePath("brief.md"))).toBe("root brief");
    expect(at(pending.pathname)).toBeUndefined();
  });

  it("never lets a deleted copy's grant write reach Drive", async () => {
    const { session } = await upload("gone.md", "copy bytes", {
      pinLabelsEmpty: true,
    });
    const deleted = await call("DELETE", "/delete", {
      pathname: session.pathname,
    });
    expect(deleted.status).toBe(204);

    put(session, "late bytes");

    expect((await finalize(session)).status).toBe(404);
    expect(at(session.pathname)).toBeUndefined();
    // A store whose backfill never ran adopts nothing from the late write.
    await prisma.fileEvidenceScope.updateMany({
      where: { workspaceId: owner.workspaceId },
      data: { backfilledAt: null, backfillCursor: null },
    });
    const backfill = await backfillDriveStore({
      workspaceId: owner.workspaceId,
      scope: "user",
      ownerId: owner.userId,
    });
    expect(backfill.adopted).toBe(0);
  });

  it("never lets a renamed copy's grant write replace or relabel it", async () => {
    const { session, resourceId } = await upload("kept.md", "copy bytes", {
      pinLabelsEmpty: true,
    });
    const renamed = await call("PATCH", "/rename", {
      oldPathname: session.pathname,
      newFilename: "kept-copy.md",
    });
    expect(renamed.status).toBe(200);

    put(session, "late bytes");

    expect((await finalize(session)).status).toBe(404);
    expect(at(session.pathname)).toBeUndefined();
    // Finalizing the new name finds no staged attempt of its own: the late
    // write is never promoted, and the renamed copy keeps its bytes.
    await finalize({ ...session, pathname: drivePath("kept-copy.md") });
    expect(at(drivePath("kept-copy.md"))).toBe("copy bytes");
    expect(
      [...fake.objects.keys()].filter((key) => key.startsWith("drive/")),
    ).toEqual([drivePath("kept-copy.md")]);
    expect(await row(drivePath("kept-copy.md"))).toMatchObject({
      id: resourceId,
    });
    expect(await pins(resourceId)).toBe(2);
    expect(await suggestionsAsked(resourceId)).toBe(0);
  });

  it("promotes only the current attempt when an upload is retried", async () => {
    const first = await mint("retry.md");
    const second = await mint("retry.md");
    put(first, "first attempt");

    expect((await finalize(first)).status).toBe(409);
    expect(at(first.pathname)).toBeUndefined();

    put(second, "second attempt");
    expect((await finalize(second)).status).toBe(200);
    expect(at(second.pathname)).toBe("second attempt");
  });

  it("carries every document's row with its bytes through a folder rename", async () => {
    const { resourceId } = await upload("q1.md", "q1", { folder: "reports" });
    const pending = await mint("q2.md", { folder: "reports" });

    const renamed = await call(
      "PATCH",
      "/rename",
      { scope: "me", oldFolderPath: "reports", newFolderPath: "archive" },
      folders,
    );

    expect(renamed.status).toBe(200);
    expect(at(drivePath("archive/q1.md"))).toBe("q1");
    expect(await row(drivePath("archive/q1.md"))).toMatchObject({
      id: resourceId,
    });
    // A pending upload has no bytes to move; it keeps its own name.
    expect(await row(pending.pathname)).toMatchObject({ lifecycle: "PENDING" });
  });

  describe("one authorized attempt per publication", () => {
    it("lets a re-mint wait for a publication in flight, never slip in", async () => {
      const first = await mint("race.md");
      put(first, "first attempt");
      let remint: Promise<Response> | undefined;
      // Mid-publication, inside the storage move, a second attempt mints.
      fake.hooks.beforeRename = async () => {
        remint = Promise.resolve(requestMint("race.md"));
        await new Promise((resolve) => setTimeout(resolve, 200));
      };

      const finalized = await finalize(first);
      const reminted = await (remint as Promise<Response>);

      expect(finalized.status).toBe(200);
      expect(at(first.pathname)).toBe("first attempt");
      // The re-mint saw the published file and could not replace it.
      expect(reminted.status).toBe(409);
      expect(await row(first.pathname)).toMatchObject({ lifecycle: "ACTIVE" });
    });

    it("touches no storage for an attempt a newer one replaced", async () => {
      const first = await mint("later.md");
      put(first, "first attempt");
      const second = await mint("later.md");
      fake.mutations.length = 0;

      expect((await finalize(first)).status).toBe(409);
      expect(fake.mutations).toEqual([]);
      expect(at(first.pathname)).toBeUndefined();

      put(second, "second attempt");
      expect((await finalize(second)).status).toBe(200);
      expect(at(second.pathname)).toBe("second attempt");
    });

    it("finishes a publication whose move landed but whose activation rolled back", async () => {
      const session = await mint("flaky.md");
      put(session, "flaky bytes");
      fake.hooks.afterRename = () => {
        delete fake.hooks.afterRename;
        throw new Error("connection reset after the move");
      };

      expect((await finalize(session)).status).toBe(500);
      expect(at(session.pathname)).toBe("flaky bytes");
      expect(await row(session.pathname)).toMatchObject({
        lifecycle: "PENDING",
      });

      expect((await finalize(session)).status).toBe(200);
      expect(await row(session.pathname)).toMatchObject({
        lifecycle: "ACTIVE",
      });
    });

    it("re-checks room access at finalize and touches no storage when it is gone", async () => {
      const session = await mint("room.md", { folder: "deal" });
      put(session, "room bytes");
      fake.mutations.length = 0;
      // Access to the destination was taken away after the mint.
      access.requireDriveFileAccess.mockImplementation(
        async (...args: unknown[]) => {
          const paths = args[3] as { into?: string[] } | undefined;
          if (paths?.into?.includes("deal"))
            throw Object.assign(new Error("File not found"), { status: 404 });
          return { hiddenRoomFolders: [] };
        },
      );

      expect((await finalize(session)).status).not.toBe(200);
      expect(fake.mutations).toEqual([]);
      expect(at(session.pathname)).toBeUndefined();
    });
  });

  describe("rollout: released clients keep the released flow", () => {
    it("puts an old client's upload in Drive at PUT, and finalizes it", async () => {
      const session = await mint("legacy.md", { staged: false });

      expect(session.attemptId).toBeUndefined();
      expect(session.uploadUrl).toBe(`fake-put://${session.pathname}`);
      put(session, "legacy bytes");
      expect(at(session.pathname)).toBe("legacy bytes");

      const response = await finalize(session);
      expect(response.status).toBe(200);
      expect((await response.json()).data.fileUrl).toBe(
        `https://blob.test/${session.pathname}`,
      );
      expect(await row(session.pathname)).toMatchObject({
        lifecycle: "ACTIVE",
      });
    });

    it("never activates an old grant's bytes as a newer staged attempt", async () => {
      const legacy = await mint("mixed.md", { staged: false });
      const staged = await mint("mixed.md");
      // The old grant lands late, straight on the pathname.
      put(legacy, "legacy bytes");

      // The released finalize cannot activate: the current upload is staged.
      expect((await finalize(legacy)).status).toBe(404);
      // The staged attempt cannot claim bytes it did not write.
      put(staged, "staged bytes");
      expect((await finalize(staged)).status).toBe(409);
      expect(at(staged.pathname)).toBe("legacy bytes");
      expect(await row(staged.pathname)).toMatchObject({
        lifecycle: "PENDING",
      });
    });
  });

  describe("deleting", () => {
    it("keeps failed-delete bytes owned, so nothing relabels them, and finishes on retry", async () => {
      const { session, resourceId } = await upload("keep.md", "copy bytes", {
        pinLabelsEmpty: true,
      });
      fake.hooks.beforeDel = () => {
        delete fake.hooks.beforeDel;
        throw new Error("store 503");
      };

      const failed = await call("DELETE", "/delete", {
        pathname: session.pathname,
      });
      expect(failed.status).toBe(500);
      expect(at(session.pathname)).toBe("copy bytes");

      // An incomplete backfill and a rename both leave the leftover alone.
      await prisma.fileEvidenceScope.updateMany({
        where: { workspaceId: owner.workspaceId },
        data: { backfilledAt: null, backfillCursor: null },
      });
      const backfill = await backfillDriveStore({
        workspaceId: owner.workspaceId,
        scope: "user",
        ownerId: owner.userId,
      });
      expect(backfill.adopted).toBe(0);
      const renamed = await call("PATCH", "/rename", {
        oldPathname: session.pathname,
        newFilename: "revived.md",
      });
      expect(renamed.status).toBe(409);
      expect(await row(session.pathname)).toBeNull();
      const before = evaluator.calls;

      const retried = await call("DELETE", "/delete", {
        pathname: session.pathname,
      });
      expect(retried.status).toBe(204);
      expect(at(session.pathname)).toBeUndefined();
      expect(
        await prisma.fileResource.findUniqueOrThrow({
          where: { id: resourceId },
          select: { lifecycle: true, sourceId: true },
        }),
      ).toEqual({
        lifecycle: "TOMBSTONED",
        sourceId: `${session.pathname}#tombstoned:${resourceId}`,
      });
      expect(evaluator.calls).toBe(before);
    });

    it("leaves a newer object alone when a slow delete finally runs", async () => {
      const { session } = await upload("swap.md", "old bytes");
      // Between this delete's read and its storage call, a server writer
      // replaces the bytes (Soko Bot's overwrite).
      fake.hooks.beforeDel = () => {
        delete fake.hooks.beforeDel;
        fake.write(session.pathname, "new bytes", "text/markdown", true);
      };

      const deleted = await call("DELETE", "/delete", {
        pathname: session.pathname,
      });

      // The request says the file changed instead of claiming a delete.
      expect(deleted.status).toBe(409);
      expect(at(session.pathname)).toBe("new bytes");
      // The deleted document's hold ended with the bytes it observed.
      expect(
        await prisma.fileResource.count({
          where: {
            workspaceId: owner.workspaceId,
            sourceId: { startsWith: `${session.pathname}#deleting:` },
          },
        }),
      ).toBe(0);
    });
  });

  describe("round 2 interleavings", () => {
    function currentVersion(pathname: string) {
      return prisma.fileResource.findFirst({
        where: { workspaceId: owner.workspaceId, sourceId: pathname },
        select: {
          lifecycle: true,
          versions: {
            orderBy: { revision: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      });
    }

    it("a stale delete leaves the document that replaced its observed one alone", async () => {
      const { session } = await upload("stale.md", "old bytes");
      let replacement: { resourceId: string; jobs: number } | undefined;
      // The delete's storage read (after the route's 404 check) sees the old
      // object; then another delete and a re-upload (a copy) complete.
      fake.hooks.afterHead = {
        pathname: session.pathname,
        skip: 1,
        run: async () => {
          expect(
            (await call("DELETE", "/delete", { pathname: session.pathname }))
              .status,
          ).toBe(204);
          const again = await upload("stale.md", "new bytes");
          replacement = {
            resourceId: again.resourceId,
            jobs: await prisma.fileIndexJob.count({
              where: { resourceId: again.resourceId, state: "QUEUED" },
            }),
          };
        },
      };

      const stale = await call("DELETE", "/delete", {
        pathname: session.pathname,
      });

      expect(stale.status).toBe(409);
      expect(at(session.pathname)).toBe("new bytes");
      const live = replacement as { resourceId: string; jobs: number };
      expect(await row(session.pathname)).toEqual({
        id: live.resourceId,
        lifecycle: "ACTIVE",
      });
      expect(
        await prisma.fileIndexJob.count({
          where: { resourceId: live.resourceId, state: "QUEUED" },
        }),
      ).toBe(live.jobs);
    });

    it("a stale delete never holds a copy that replaced its observed document", async () => {
      const { session: original, resourceId: originalId } = await upload(
        "held.md",
        "old bytes",
      );
      const { resourceId: copyId } = await upload("copy.md", "copy bytes", {
        pinLabelsEmpty: true,
      });
      // The original document is gone; the copy now holds that pathname.
      await prisma.fileResource.update({
        where: { id: originalId },
        data: {
          sourceId: `${original.pathname}#tombstoned:${originalId}`,
          tombstonedAt: new Date(),
          lifecycle: "TOMBSTONED",
        },
      });
      await prisma.fileResource.update({
        where: { id: copyId },
        data: { sourceId: original.pathname },
      });
      const { holdDriveUploadForDelete } = await import(
        "@/services/file-catalog.service"
      );

      await expect(
        holdDriveUploadForDelete({
          key: {
            workspaceId: owner.workspaceId,
            scope: "user",
            ownerId: owner.userId,
            pathname: original.pathname,
          },
          resourceId: originalId,
          revision: 1,
        }),
      ).resolves.toBe(false);
      expect(await row(original.pathname)).toEqual({
        id: copyId,
        lifecycle: "ACTIVE",
      });
      expect(await pins(copyId)).toBe(2);
      expect(await suggestionsAsked(copyId)).toBe(0);
    });

    it("a released finalize racing a staged re-mint never activates the stale version", async () => {
      const legacy = await mint("racy.md", { staged: false });
      put(legacy, "legacy bytes");
      let staged: Session | undefined;
      // The released finalize has read the bytes; a staged re-mint commits.
      fake.hooks.afterHead = {
        pathname: legacy.pathname,
        skip: 0,
        run: async () => {
          // The bytes block a re-mint, so it is a staged reservation made
          // through the catalog directly, as a re-mint from before the PUT.
          const { reserveDriveUploadResource } = await import(
            "@/services/file-catalog.service"
          );
          const reserved = await reserveDriveUploadResource({
            key: {
              workspaceId: owner.workspaceId,
              scope: "user",
              ownerId: owner.userId,
              pathname: legacy.pathname,
            },
            displayName: "racy.md",
            mimeType: "text/markdown",
            sizeBytes: 3,
            staged: true,
          });
          staged = { ...legacy, attemptId: reserved.versionId };
        },
      };
      const before = evaluator.calls;

      expect((await finalize(legacy)).status).toBe(404);
      const state = await currentVersion(legacy.pathname);
      expect(state?.lifecycle).toBe("PENDING");
      expect(state?.versions[0]?.id).toBe(staged?.attemptId);
      expect(evaluator.calls).toBe(before);
    });

    it("lets no re-mint take a name while a promotion is in flight", async () => {
      const first = await mint("inflight.md");
      put(first, "first attempt");
      let remint: Response | undefined;
      // The move is still on its way when another upload of the name mints.
      fake.hooks.beforeRename = async () => {
        delete fake.hooks.beforeRename;
        remint = await requestMint("inflight.md");
      };

      const finalized = await finalize(first);

      expect(remint?.status).toBe(409);
      expect(finalized.status).toBe(200);
      expect(at(first.pathname)).toBe("first attempt");
      const state = await currentVersion(first.pathname);
      expect(state?.lifecycle).toBe("ACTIVE");
      expect(state?.versions[0]?.id).toBe(first.attemptId);
    });

    it("a re-mint after an ambiguous move finishes it instead of replacing it", async () => {
      const first = await mint("ambiguous.md", { pinLabelsEmpty: true });
      put(first, "copy bytes");
      fake.hooks.afterRename = () => {
        delete fake.hooks.afterRename;
        throw new Error("connection reset after the move");
      };
      expect((await finalize(first)).status).toBe(500);
      expect(at(first.pathname)).toBe("copy bytes");

      // Another upload of the name: the claim is resolved first.
      const competing = await requestMint(baseName(first.pathname), {
        staged: false,
      });

      expect(competing.status).toBe(409);
      const state = await currentVersion(first.pathname);
      expect(state?.lifecycle).toBe("ACTIVE");
      expect(state?.versions[0]?.id).toBe(first.attemptId);
      const resourceId = (await row(first.pathname))?.id as string;
      expect(await pins(resourceId)).toBe(2);
      expect(await suggestionsAsked(resourceId)).toBe(0);
    });
  });
});
