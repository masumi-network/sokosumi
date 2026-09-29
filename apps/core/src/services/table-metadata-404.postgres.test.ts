/**
 * REPRODUCTION ARTIFACT — a native table appears in Drive as an ordinary
 * file, and every metadata write to it answers "file not found".
 *
 * Written by the reviewer, not the implementer. This is the failing evidence
 * a fix has to satisfy; it contains no fix and touches no product code.
 *
 * **To run:** drop this file into `apps/core/src/services/`, then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts
 *
 * The CI step's substring filter picks it up with no further wiring.
 *
 * **The defect.** Two places disagree about how a native table's evidence
 * scope is keyed.
 *
 * `file-table-index.service.ts` creates it with `sourceId: tableId`.
 * `file-metadata.service.ts`'s `loadEditableResource` looks it back up with
 * `fes."sourceId" = COALESCE(fr."ownerUserId", fr."ownerOrganizationId")`.
 * For a native-table resource those are never the same value — one is the
 * table's id, the other is the workspace's owner — so the subselect yields
 * NULL, `loadEditableResource` returns null on the missing scope, and every
 * caller reports the file as not found.
 *
 * It is not that the COALESCE is wrong in general. Of the four writers that
 * create an evidence scope, three key it by owner and match the reader;
 * `file-table-index.service.ts` is the only one that keys it by the source
 * object's own id. The table indexer is the outlier, not the lookup.
 *
 * **What a user sees.** A data table sits in the Drive file list like any
 * other file. Adding a tag or setting a category on it comes back "file not
 * found" while the file is visibly there. The thing that is actually wrong —
 * that this document has no metadata scope to write into — is reported as
 * the document not existing.
 *
 * **Deliberately asserted at the level a user experiences it.** The
 * assertions below are "the file is listed" and "a metadata write to it
 * succeeds", not "the subselect returns a row". A test that asserted the
 * subselect would pass against a fix that keyed the scope any which way, and
 * would have been written against the reviewer's description of the defect
 * rather than the defect.
 *
 * **The fixture is built by the real indexer.** `createDataTable` then
 * `indexDataTable` — the same path `/sync/drive-index` runs — so the
 * `file_resource` row and its evidence scope are created the way production
 * creates them. Nothing here hand-inserts a row shaped to match the
 * hypothesis.
 *
 * **Measured on PostgreSQL 18.6 against the branch at e3d5da3da:**
 *
 *   the table is listed in Drive                        : yes
 *   updateFileMetadata on it                            : status "not-found"
 *   the same write on a DRIVE_UPLOAD file               : status "applied"
 *
 * Case 2 fails today. Cases 1 and 3 pass today and both are load-bearing:
 * 1 is the premise, so the failure cannot be dismissed as the file not being
 * there, and 3 is the control that says the defect is the source kind rather
 * than the fixture or the actor.
 */
import { randomUUID } from "node:crypto";
import {
  FileLabelKind,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDataTable, type TableActor } from "@/helpers/data-table";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { retrieveFileCandidates } from "@/lib/files/retrieval";
import { updateFileMetadata } from "@/services/file-metadata.service";
import { indexDataTable } from "@/services/file-table-index.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let workspaceId = "";
let tagLabelId = "";

const fileActor = (): FileActor => ({
  userId: ownerId,
  organizationId: null,
  kind: "interactive",
});

const tableActor = (): TableActor => ({
  workspaceId,
  userId: ownerId,
  actorId: ownerId,
  actorKind: "user",
});

/** A real table, created and indexed the way the cron does it. */
async function seedIndexedTable(title: string): Promise<string> {
  const table = await createDataTable(tableActor(), {
    key: `tbl-${randomUUID().slice(0, 8)}`,
    title,
    description: "",
    columns: [
      { name: "Supplier", type: "text", description: "", options: [] },
      { name: "City", type: "text", description: "", options: [] },
    ],
    rows: [],
  });
  await prisma.tableRow.createMany({
    data: [
      {
        tableId: table.id,
        values: {
          [table.columns[0].id]: "Northwind",
          [table.columns[1].id]: "Rotterdam",
        },
      },
    ],
  });

  // The real indexer. This is what creates the NATIVE_TABLE file_resource
  // and its evidence scope.
  const indexed = await indexDataTable(tableActor(), table.id);
  return indexed.resourceId;
}

/** A Drive upload, as the control. */
async function seedUpload(name: string): Promise<string> {
  await ensureEvidenceScope({
    workspaceId,
    sourceKind: FileSourceKind.DRIVE_UPLOAD,
    sourceScope: FileSourceScope.USER,
    sourceId: ownerId,
  });
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `users/${ownerId}/${name}`,
      ownerUserId: ownerId,
      displayName: name,
      normalizedName: name,
      lifecycle: FileResourceLifecycle.ACTIVE,
      contentRevision: 1,
    },
    select: { id: true },
  });
  return resource.id;
}

async function addTag(resourceId: string) {
  const current = await prisma.fileResource.findUniqueOrThrow({
    where: { id: resourceId },
    select: { metadataRevision: true },
  });
  return updateFileMetadata({
    workspaceId,
    actor: fileActor(),
    resourceId,
    request: {
      expectedMetadataRevision: current.metadataRevision,
      addTagLabelIds: [tagLabelId],
    },
  });
}

describe.skipIf(!enabled)(
  "a file Drive shows must accept a metadata write",
  () => {
    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "Table metadata owner",
          email: `table-meta-${suffix}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      ownerId = owner.id;
      workspaceId = (
        await prisma.workspace.create({
          data: { userId: ownerId },
          select: { id: true },
        })
      ).id;
      tagLabelId = (
        await prisma.workspaceLabel.create({
          data: {
            workspaceId,
            kind: FileLabelKind.TAG,
            displayName: "Suppliers",
            normalizedName: "suppliers",
            description: "Supplier records",
          },
          select: { id: true },
        })
      ).id;
    }, 120_000);

    afterAll(async () => {
      await prisma.fileResource.deleteMany({ where: { workspaceId } });
      await prisma.dataTable.deleteMany({ where: { workspaceId } });
      await prisma.workspaceLabel.deleteMany({ where: { workspaceId } });
      await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });

    /**
     * The premise, so the failure below cannot be dismissed as the file not
     * being there. Passes today.
     */
    it("1. an indexed native table is listed in Drive like any other file", async () => {
      const resourceId = await seedIndexedTable(`Suppliers ${suffix}`);

      const listing = await retrieveFileCandidates({
        workspaceId,
        actor: fileActor(),
        query: null,
        filters: {},
        sortBy: "modified",
        sortOrder: "desc",
      });

      expect(
        listing.candidates.map((candidate) => candidate.resourceId),
      ).toContain(resourceId);
    }, 300_000);

    /**
     * FAILS TODAY. Measured: `status: "not-found"` for a file the previous
     * case just found in the listing.
     */
    it("2. a metadata write to that table succeeds", async () => {
      const resourceId = await seedIndexedTable(`Ledger ${suffix}`);

      const outcome = await addTag(resourceId);

      expect(
        outcome.status,
        `the table is listed in Drive but a metadata write to it answered ` +
          `"${outcome.status}". Its evidence scope is keyed by table id in ` +
          "file-table-index.service.ts and looked up by owner id in " +
          "loadEditableResource, so the lookup finds nothing and the route " +
          "reports the file as missing rather than reporting what is wrong.",
      ).toBe("applied");

      const written = await prisma.fileLabel.count({
        where: { resourceId, labelId: tagLabelId },
      });
      expect(written, "no label row was written").toBe(1);
    }, 300_000);

    /**
     * PASSES TODAY, and must keep passing. The control: the same write on a
     * Drive upload works, so case 2 is about the source kind and not about
     * the fixture or the actor.
     */
    it("3. the same write on a Drive upload still succeeds", async () => {
      const resourceId = await seedUpload(`control-${suffix}.txt`);

      const outcome = await addTag(resourceId);

      expect(outcome.status).toBe("applied");
      expect(
        await prisma.fileLabel.count({
          where: { resourceId, labelId: tagLabelId },
        }),
      ).toBe(1);
    }, 300_000);
  },
);
