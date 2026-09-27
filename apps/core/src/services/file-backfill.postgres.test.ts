import { randomUUID } from "node:crypto";

import { FileSourceKind, FileSourceScope } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";

/**
 * Backfill has to *record* that it finished, or it never finishes.
 *
 * The progress write was an `updateMany` against the store's evidence
 * scope, and nothing guarantees that row exists: it is created by
 * `adoptDriveUploadResource`, which only runs when there is something to
 * adopt. So a store that adopts nothing matched zero rows, persisted
 * neither cursor nor completion, and returned `complete: true` anyway —
 * while `isDriveStoreBackfillPending` kept answering "yes" forever.
 *
 * That is on the hot path: every `GET /v1/drive/search` calls it. An empty
 * Drive therefore issued a blob listing before every single search, for the
 * life of the account. Only a real database shows this, because the bug is
 * that an update matched no rows.
 */

const { listMock, blob } = vi.hoisted(() => ({
  listMock: vi.fn(),
  /** Mutable, so a test can take the token away. */
  blob: { token: "test-token" as string | undefined },
}));

vi.mock("@vercel/blob", () => ({ list: listMock }));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: blob.token,
    }),
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let userId = "";
let workspaceId = "";

describe.skipIf(!enabled)("Drive store backfill", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Backfill owner",
        email: `backfill-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    userId = user.id;
    workspaceId = (
      await prisma.workspace.create({
        data: { userId },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (!enabled) return;
    await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("stops asking once an empty store has been walked", async () => {
    listMock.mockResolvedValue({ blobs: [], hasMore: false, cursor: null });

    const { backfillDriveStore, isDriveStoreBackfillPending } = await import(
      "@/services/file-backfill.service"
    );

    const first = await backfillDriveStore({
      workspaceId,
      scope: "user",
      ownerId: userId,
    });
    expect(first).toMatchObject({ adopted: 0, complete: true });

    // The claim under test: completion was actually written down.
    await expect(
      isDriveStoreBackfillPending({
        workspaceId,
        scope: "user",
        ownerId: userId,
      }),
    ).resolves.toBe(false);

    // And a second visit costs nothing — no listing at all.
    listMock.mockClear();
    const second = await backfillDriveStore({
      workspaceId,
      scope: "user",
      ownerId: userId,
    });
    expect(second).toMatchObject({ scanned: 0, complete: true });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("records the row it needs rather than assuming one exists", async () => {
    // The direct form of the same thing: after walking a store that
    // adopted nothing, the evidence scope for that store exists and
    // carries the completion stamp.
    const scope = await prisma.fileEvidenceScope.findUnique({
      where: {
        workspaceId_sourceKind_sourceScope_sourceId: {
          workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope: FileSourceScope.USER,
          sourceId: userId,
        },
      },
      select: { backfilledAt: true, backfillCursor: true },
    });

    expect(scope).not.toBeNull();
    expect(scope?.backfilledAt).toBeInstanceOf(Date);
    expect(scope?.backfillCursor).toBeNull();
  });

  it("is not pending when there is no blob store to adopt from", async () => {
    /**
     * The unbounded spend path, closed.
     *
     * `backfillDriveStore` returns at its first line when
     * `BLOB_READ_WRITE_TOKEN` is unset — before it can write
     * `backfilledAt` — so the marker this check reads was never set and
     * the answer was "pending" forever.
     *
     * The cost was not a wasted query. The one caller,
     * `GET /v1/drive/search`, nudges the indexer inside this branch, and
     * that nudge used to drain label suggestion: a paid model call per
     * document. A missing environment variable therefore made every
     * search spend money with no condition that could ever end it. The
     * other half of the fix is in `in-process-indexer.test.ts`, where the
     * read path no longer buys evaluations at all.
     *
     * A store with no `backfilledAt` row at all is used deliberately:
     * that is the state the forever case leaves behind, and the state
     * that answered "yes" every time.
     */
    const { isDriveStoreBackfillPending } = await import(
      "@/services/file-backfill.service"
    );

    const owner = await prisma.user.create({
      data: {
        name: "Tokenless owner",
        email: `tokenless-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const store = await prisma.workspace.create({
      data: { userId: owner.id },
      select: { id: true },
    });

    const ask = async () =>
      isDriveStoreBackfillPending({
        workspaceId: store.id,
        scope: "user",
        ownerId: owner.id,
      });

    // With a token it is pending, because nothing has recorded completion.
    // Without this the assertion below would hold for the wrong reason.
    expect(await ask()).toBe(true);

    const previous = blob.token;
    blob.token = undefined;
    try {
      expect(await ask()).toBe(false);
    } finally {
      blob.token = previous;
    }

    // And configuring a token later brings it back, rather than the store
    // being permanently marked as done.
    expect(await ask()).toBe(true);
  });

  it("does not let a failing blob listing take down the read", async () => {
    /**
     * The second way into the same wedge, and the one left open.
     *
     * The completion marker is written only after the paging loop, so any
     * throw from `list()` — or from an adoption inside the loop — skips
     * it. The store stays pending, the next Drive search calls backfill
     * again, and it throws again. Unguarded on the route, that is a 500
     * on every Drive search for as long as the Blob API is unhappy, with
     * no fallback to the catalog search that would have worked from
     * Postgres the whole time.
     *
     * Not overspending — no search at all, caused by a dependency the
     * search does not need. Failing gracefully is the stated requirement
     * for this feature and this was its clearest violation.
     */
    const { adoptDriveStoreIfPending, isDriveStoreBackfillPending } =
      await import("@/services/file-backfill.service");

    const owner = await prisma.user.create({
      data: {
        name: "Listing failure owner",
        email: `listing-fail-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const space = await prisma.workspace.create({
      data: { userId: owner.id },
      select: { id: true },
    });
    const store = {
      workspaceId: space.id,
      scope: "user" as const,
      ownerId: owner.id,
    };

    listMock.mockRejectedValue(new Error("Blob store unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Does not throw — that is the whole point.
    await expect(adoptDriveStoreIfPending(store)).resolves.toEqual({
      ran: true,
      failed: true,
    });

    // And it says why, rather than degrading silently.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    // The store is still pending, correctly: nothing was adopted, so
    // claiming completion would be a lie that outlives the outage. The
    // fix is that pending no longer means the read dies.
    expect(await isDriveStoreBackfillPending(store)).toBe(true);

    // Twice, because the failure repeats every search and must keep
    // being survivable rather than degrading into something worse.
    await expect(adoptDriveStoreIfPending(store)).resolves.toEqual({
      ran: true,
      failed: true,
    });
  });

  it("reports that it did nothing when there was nothing to do", async () => {
    /**
     * The other branch, so "never throws" is not achieved by never
     * running. A store already marked complete must report `ran: false`,
     * and the caller uses that to decide whether to nudge the indexer.
     */
    const { adoptDriveStoreIfPending } = await import(
      "@/services/file-backfill.service"
    );

    const owner = await prisma.user.create({
      data: {
        name: "Settled store owner",
        email: `settled-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const space = await prisma.workspace.create({
      data: { userId: owner.id },
      select: { id: true },
    });
    const { ensureEvidenceScope } = await import("@/lib/files/evidence-scope");
    const scope = await ensureEvidenceScope({
      workspaceId: space.id,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: owner.id,
    });
    await prisma.fileEvidenceScope.update({
      where: { id: scope.id },
      data: { backfilledAt: new Date() },
    });

    listMock.mockRejectedValue(new Error("must not be called"));

    await expect(
      adoptDriveStoreIfPending({
        workspaceId: space.id,
        scope: "user",
        ownerId: owner.id,
      }),
    ).resolves.toEqual({ ran: false });
  });
});
