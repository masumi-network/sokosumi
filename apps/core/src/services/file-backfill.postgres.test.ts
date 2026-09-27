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

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock("@vercel/blob", () => ({ list: listMock }));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: "test-token",
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
});
