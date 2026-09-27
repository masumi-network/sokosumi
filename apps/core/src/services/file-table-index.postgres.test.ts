import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TableActor } from "@/helpers/data-table";
import { createDataTable } from "@/helpers/data-table";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { chunkExtractedText } from "@/lib/files/extraction";
import { writeVersionChunks } from "@/services/file-index.service";
import { searchFiles } from "@/services/file-search.service";
import {
  indexDataTable,
  renderTableRow,
  TABLE_INDEX_MAX_ROWS,
} from "@/services/file-table-index.service";

/**
 * Table contents in search, and — more importantly — not in someone else's.
 *
 * This is the gap where an authorization mistake leaks another workspace's
 * rows, so the test that matters most is the negative one. It needs a real
 * database: the authorized relation is raw SQL joining `data_table`, and a
 * mocked Prisma would assert nothing about it.
 */

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);

let ownerId = "";
let outsiderId = "";
let workspaceId = "";
let otherWorkspaceId = "";
let tableId = "";
let otherTableId = "";

function tableActor(userId: string, workspace: string): TableActor {
  return {
    workspaceId: workspace,
    userId,
    actorId: userId,
    actorKind: "user",
  };
}

function fileActor(userId: string): FileActor {
  return { userId, organizationId: null, kind: "interactive" };
}

/** The parts of a search request this suite does not vary. */
const SEARCH_DEFAULTS = {
  filters: {},
  sortBy: "relevance" as const,
  sortOrder: "desc" as const,
  cursor: null,
};

async function seedTable(
  actor: TableActor,
  title: string,
  rows: Record<string, string>[],
): Promise<string> {
  const table = await createDataTable(actor, {
    key: `tbl-${randomUUID().slice(0, 8)}`,
    title,
    description: "",
    columns: [
      { name: "Supplier", type: "text", description: "", options: [] },
      { name: "City", type: "text", description: "", options: [] },
    ],
    rows: [],
  });

  const columns = table.columns;
  await prisma.tableRow.createMany({
    data: rows.map((row) => ({
      tableId: table.id,
      values: {
        [columns[0].id]: row.supplier,
        [columns[1].id]: row.city,
      },
    })),
  });

  return table.id;
}

describe.skipIf(!enabled)("indexing a native table", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Table owner",
        email: `table-owner-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const outsider = await prisma.user.create({
      data: {
        name: "Table outsider",
        email: `table-outsider-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    ownerId = owner.id;
    outsiderId = outsider.id;

    workspaceId = (
      await prisma.workspace.create({
        data: { userId: ownerId },
        select: { id: true },
      })
    ).id;
    otherWorkspaceId = (
      await prisma.workspace.create({
        data: { userId: outsiderId },
        select: { id: true },
      })
    ).id;

    tableId = await seedTable(tableActor(ownerId, workspaceId), "Suppliers", [
      { supplier: "Aurora Components", city: "Bristol" },
      { supplier: "Northwind Metals", city: "Leeds" },
    ]);
    otherTableId = await seedTable(
      tableActor(outsiderId, otherWorkspaceId),
      "Their suppliers",
      [{ supplier: "Confidential Partner", city: "Zurich" }],
    );
  });

  afterAll(async () => {
    if (!enabled) return;
    for (const id of [workspaceId, otherWorkspaceId]) {
      await prisma.fileResource.deleteMany({ where: { workspaceId: id } });
      await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId: id } });
      await prisma.fileResultWindow.deleteMany({ where: { workspaceId: id } });
      await prisma.dataTable.deleteMany({ where: { workspaceId: id } });
      await prisma.workspace.deleteMany({ where: { id } });
    }
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, outsiderId] } },
    });
  });

  it("makes a row findable by a value inside it", async () => {
    const result = await indexDataTable(
      tableActor(ownerId, workspaceId),
      tableId,
    );
    expect(result.rowsIndexed).toBe(2);
    expect(result.state).toBe("INDEXED");
    expect(result.coverage).toBe(1);

    const search = await searchFiles({
      workspaceId,
      actor: fileActor(ownerId),
      query: "Northwind",
      limit: 10,
      ...SEARCH_DEFAULTS,
    });

    const names = search.items.map((item) => item.displayName);
    expect(names).toContain("Suppliers");
  });

  it("does not show one workspace's table to another", async () => {
    await indexDataTable(tableActor(ownerId, workspaceId), tableId);
    await indexDataTable(
      tableActor(outsiderId, otherWorkspaceId),
      otherTableId,
    );

    // The outsider's own workspace: they see their own table and nothing else.
    const theirs = await searchFiles({
      workspaceId: otherWorkspaceId,
      actor: fileActor(outsiderId),
      query: "Confidential",
      limit: 10,
      ...SEARCH_DEFAULTS,
    });
    expect(theirs.items.map((item) => item.displayName)).toContain(
      "Their suppliers",
    );

    // The owner searching for the outsider's content finds nothing, and the
    // outsider searching for the owner's finds nothing.
    const leak = await searchFiles({
      workspaceId,
      actor: fileActor(ownerId),
      query: "Confidential",
      limit: 10,
      ...SEARCH_DEFAULTS,
    });
    expect(leak.items).toHaveLength(0);

    const reverse = await searchFiles({
      workspaceId: otherWorkspaceId,
      actor: fileActor(outsiderId),
      query: "Northwind",
      limit: 10,
      ...SEARCH_DEFAULTS,
    });
    expect(reverse.items).toHaveLength(0);
  });

  it("will not serve a catalog row that points at another workspace's table", async () => {
    /**
     * What the arm's own join guards, as distinct from the outer workspace
     * filter every Files query already has.
     *
     * The outer filter stops workspace A's *search* from reaching workspace
     * B's *resources*. It does nothing about a resource that is filed under
     * A but whose `sourceId` names a table belonging to B — a mis-indexed
     * row, which is exactly what a mistake in the indexer would produce.
     * The join `dt."workspaceId" = fr."workspaceId"` is what refuses that.
     */
    await indexDataTable(tableActor(ownerId, workspaceId), tableId);

    const planted = await prisma.fileResource.create({
      data: {
        workspaceId,
        sourceKind: "NATIVE_TABLE",
        sourceScope: "USER",
        // Filed under the owner's workspace, pointing at the outsider's table.
        sourceId: otherTableId,
        ownerUserId: ownerId,
        displayName: "Planted",
        normalizedName: "planted",
        mimeType: "text/plain",
        lifecycle: "ACTIVE",
        versions: {
          create: {
            revision: 1,
            objectKey: `table:${otherTableId}`,
            mimeType: "text/plain",
            extractionState: "INDEXED",
            extractionCoverage: 1,
          },
        },
      },
      select: { id: true, versions: { select: { id: true } } },
    });

    const scope = await prisma.fileEvidenceScope.findFirst({
      where: { workspaceId, sourceKind: "NATIVE_TABLE" },
      select: { id: true, scopeVersion: true },
    });
    if (!scope) throw new Error("expected a scope");

    await writeVersionChunks({
      versionId: planted.versions[0].id,
      evidenceScopeId: scope.id,
      scopeVersion: scope.scopeVersion,
      chunks: chunkExtractedText("Supplier: Confidential Partner"),
    });

    try {
      const search = await searchFiles({
        workspaceId,
        actor: fileActor(ownerId),
        query: "Confidential",
        limit: 10,
        ...SEARCH_DEFAULTS,
      });
      expect(search.items).toHaveLength(0);
    } finally {
      await prisma.fileResource.delete({ where: { id: planted.id } });
    }
  });

  it("refuses to index a table from another workspace", async () => {
    // The gate, not the query: `requireDataTable` binds table to workspace.
    await expect(
      indexDataTable(tableActor(ownerId, workspaceId), otherTableId),
    ).rejects.toThrow();
  });

  it("hides a table's rows again once it is archived", async () => {
    await indexDataTable(tableActor(ownerId, workspaceId), tableId);
    await prisma.dataTable.update({
      where: { id: tableId },
      data: { archivedAt: new Date() },
    });

    try {
      const search = await searchFiles({
        workspaceId,
        actor: fileActor(ownerId),
        query: "Northwind",
        limit: 10,
        ...SEARCH_DEFAULTS,
      });
      expect(search.items).toHaveLength(0);
    } finally {
      await prisma.dataTable.update({
        where: { id: tableId },
        data: { archivedAt: null },
      });
    }
  });
});

describe("renderTableRow", () => {
  const columns = [
    { id: "c1", name: "Supplier" },
    { id: "c2", name: "City" },
    { id: "c3", name: "Tags" },
  ];

  it("reads as a row, not as a JSON blob", () => {
    expect(
      renderTableRow(columns, {
        c1: "Aurora Components",
        c2: "Bristol",
      }),
    ).toBe("Supplier: Aurora Components · City: Bristol");
  });

  it("drops empty cells so a sparse table is not a wall of column names", () => {
    expect(renderTableRow(columns, { c1: "Aurora", c2: "", c3: null })).toBe(
      "Supplier: Aurora",
    );
  });

  it("flattens a list cell", () => {
    expect(renderTableRow(columns, { c3: ["urgent", "review"] })).toBe(
      "Tags: urgent, review",
    );
  });

  it("is empty for a row with nothing in it", () => {
    expect(renderTableRow(columns, {})).toBe("");
  });

  it("keeps the caps visible to a reader of this file", () => {
    // A table can dwarf a document; the ceiling is not incidental.
    expect(TABLE_INDEX_MAX_ROWS).toBe(2_000);
  });
});
