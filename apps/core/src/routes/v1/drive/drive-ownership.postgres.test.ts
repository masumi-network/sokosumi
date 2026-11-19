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
}

/** One public Blob store: no overwrite unless asked, like Vercel Blob. */
const fake = vi.hoisted(() => {
  class BlobNotFoundError extends Error {}
  const objects = new Map<string, FakeObject>();
  const meta = (pathname: string, object: FakeObject) => ({
    pathname,
    url: `https://blob.test/${pathname}`,
    downloadUrl: `https://blob.test/${pathname}`,
    size: object.body.length,
    contentType: object.contentType,
    uploadedAt: object.uploadedAt,
    cacheControl: "public, max-age=60",
    contentDisposition: "",
    etag: `"${object.body.length}"`,
  });
  const write = (
    pathname: string,
    body: string,
    contentType: string,
    allowOverwrite = false,
  ) => {
    if (objects.has(pathname) && !allowOverwrite)
      throw new Error("Vercel Blob: This blob already exists");
    objects.set(pathname, { body, contentType, uploadedAt: new Date() });
  };
  return {
    objects,
    write,
    module: {
      BlobNotFoundError,
      head: async (pathname: string) => {
        const object = objects.get(pathname);
        if (!object) throw new BlobNotFoundError("not found");
        return meta(pathname, object);
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
        write(
          pathname,
          String(body),
          options.contentType ?? "application/octet-stream",
          options.allowOverwrite,
        );
        return { url: `https://blob.test/${pathname}`, pathname };
      },
      rename: async (from: string, to: string) => {
        const object = objects.get(from);
        if (!object) throw new BlobNotFoundError("not found");
        if (objects.has(to))
          throw new Error("Vercel Blob: This blob already exists");
        objects.delete(from);
        objects.set(to, object);
        return { url: `https://blob.test/${to}`, pathname: to };
      },
      del: async (pathnames: string | string[]) => {
        for (const pathname of [pathnames].flat()) objects.delete(pathname);
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
vi.mock("@/helpers/drive-file-access", () => ({
  drivePathOf: (pathname: string) => pathname.split("/").slice(3).join("/"),
  requireDriveFileAccess: vi.fn().mockResolvedValue({ hiddenRoomFolders: [] }),
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
}

async function mint(
  filename: string,
  options: { pinLabelsEmpty?: boolean; folder?: string } = {},
): Promise<Session> {
  const response = await call("POST", "/", {
    filename,
    contentType: "text/markdown",
    size: 64,
    scope: "me",
    ...options,
  });
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

function finalize(pathname: string) {
  return call("POST", "/finalize", { scope: "me", pathname });
}

async function upload(
  filename: string,
  body: string,
  options: { pinLabelsEmpty?: boolean; folder?: string } = {},
) {
  const session = await mint(filename, options);
  put(session, body);
  const response = await finalize(session.pathname);
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

    const response = await finalize(session.pathname);

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
    const finalized = await finalize(copy.pathname);
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

    expect((await finalize(session.pathname)).status).toBe(404);
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

    expect((await finalize(session.pathname)).status).toBe(404);
    expect(at(session.pathname)).toBeUndefined();
    // Finalizing the new name finds no staged attempt of its own: the late
    // write is never promoted, and the renamed copy keeps its bytes.
    await finalize(drivePath("kept-copy.md"));
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

    expect((await finalize(first.pathname)).status).toBe(404);
    expect(at(first.pathname)).toBeUndefined();

    put(second, "second attempt");
    expect((await finalize(second.pathname)).status).toBe(200);
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
});
