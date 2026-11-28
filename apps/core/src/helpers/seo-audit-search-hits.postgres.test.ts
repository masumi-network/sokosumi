import { randomUUID } from "node:crypto";
import { HistoryKind, TaskStatus } from "@sokosumi/database";
import { PrismaRaw as Prisma } from "@sokosumi/database/client";
import { hideSeoAuditRequest, seoTaskDescription } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  historyDescriptionMatch,
  taskDescriptionMatches,
  visibleDescriptionSql,
} from "./seo-audit-search-hits";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const otherUserId = randomUUID();
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const coworkerId = randomUUID();
const vendorId = randomUUID();
const PACKET = { price: { markupPercent: 7345 } };

/** Deeper than the Postgres JSON parser's stack allows (it throws near 20,000). */
const DEEP = 30_000;

/** Descriptions where a wrong line rule would show or hide the wrong text. */
const PARITY_CASES: Record<string, string> = {
  plain: "No request line here",
  coreWritten: seoTaskDescription("Audit of shop", "seo_audit", PACKET),
  jsonArray: 'Audit\n\nseo_audit: [{"markupPercent":7345}]',
  leadingSpaces: '  Audit\n   seo_audit :  {"a":1}  \n tail ',
  unicodeSpaces: ' Audit\n seo_audit : {"a":1}　',
  // Unicode spaces around the marker: both rules read them as space.
  unicodePrefix: 'Audit\n\t\u2003seo_audit\u00a0: {"a":1}',
  unicodeTrim: 'Audit\u3000\nseo_audit: {"a":1}',
  upperCase: 'Audit\nSEO_AUDIT: {"a":1}',
  crlf: 'Audit\r\nseo_audit: {"a":1}\r\nmore',
  malformedBraceProse: "seo_audit: {fix the price labels}",
  jsonNull: "Audit\nseo_audit: null",
  jsonString: 'Audit\nseo_audit: "markupPercent"',
  focusedLine: seoTaskDescription("Check of page", "seo_job", PACKET),
  onlyTheLine: 'seo_audit: {"a":1}',
  twoLines: 'A\nseo_audit: {"a":1}\nB\nseo_audit: [1]\nC',
  markerMidLine: 'see seo_audit: {"a":1}',
  // JSON that `jsonb` refuses and JSON.parse accepts: the line is still hidden.
  nullEscape: "Audit\n" + String.raw`seo_audit: {"a":"\u0000","\u0000":1}`,
  loneSurrogate: "Audit\n" + String.raw`seo_audit: {"a":"\ud800"}`,
  numberForms: "Audit\nseo_audit: [1e999,-0,1E+2]",
  leadingZero: "Audit\nseo_audit: [01]",
  rawTabInString: 'Audit\nseo_audit: {"a":"x\ty"}',
  deepArray: `Audit\nseo_audit: ${"[".repeat(DEEP)}${"]".repeat(DEEP)}`,
  // A JSON string cannot nest: its brackets are text, and the line stays.
  bracketString: `Audit\nseo_audit: "label ${"[".repeat(1001)}"`,
  crawlNext: seoTaskDescription("Crawl of shop", "seo_crawl_next", PACKET),
  crawlNextUpper: 'Crawl\n SEO_CRAWL_NEXT : {"a":1}',
  auditAndCrawlNext: 'A\nseo_audit: {"a":1}\nB\nseo_crawl_next: {"a":1}\nC',
};

describe.skipIf(!enabled)("visibleDescriptionSql", () => {
  it.each(Object.entries(PARITY_CASES))(
    "hides the same lines as the JS rule: %s",
    async (_name, description) => {
      const [row] = await prisma.$queryRaw<{ visible: string | null }[]>(
        Prisma.sql`SELECT ${visibleDescriptionSql(Prisma.sql`${description}::text`)} AS visible`,
      );
      expect(row.visible ?? "").toBe(hideSeoAuditRequest(description) ?? "");
    },
  );

  // Fails closed: the search hides a line it cannot check, and never errors.
  it("hides a marker line too deep for the SQL JSON parser", async () => {
    const description = `Audit\nseo_audit: ${"[".repeat(DEEP)}`;
    const [row] = await prisma.$queryRaw<{ visible: string | null }[]>(
      Prisma.sql`SELECT ${visibleDescriptionSql(Prisma.sql`${description}::text`)} AS visible`,
    );
    expect(row.visible).toBe("Audit");
  });
});

describe.skipIf(!enabled)("Task and history description search", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const [id, workspace] of [
      [userId, workspaceId],
      [otherUserId, otherWorkspaceId],
    ])
      await prisma.user.create({
        data: {
          id,
          name: "Search hits fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: workspace } },
        },
      });
    await prisma.vendor.create({
      data: { id: vendorId, slug: vendorId, name: "Search hits vendor" },
    });
    await prisma.coworker.create({
      data: { id: coworkerId, slug: coworkerId, name: "SEO checks", vendorId },
    });
    const rows: Record<string, [string, string]> = {
      hidden: [
        workspaceId,
        seoTaskDescription("Audit of shop.example", "seo_audit", PACKET),
      ],
      visible: [
        workspaceId,
        seoTaskDescription("Audit of markupPercent shop", "seo_audit", PACKET),
      ],
      // A crawl continuation's line holds price terms too.
      crawlNext: [
        workspaceId,
        seoTaskDescription("Crawl of shop.example", "seo_crawl_next", PACKET),
      ],
      // An array line is a request line too: its terms stay hidden.
      arrayLine: [workspaceId, 'Audit\n\nseo_audit: [{"markupPercent":1}]'],
      // A focused check's `seo_job` line is shown to people, so it stays searchable.
      focused: [workspaceId, seoTaskDescription("Check", "seo_job", PACKET)],
      // Prose that only starts like the marker, with no JSON: visible text.
      prose: [workspaceId, "seo_audit: {fix markupPercent labels}"],
      // Another workspace's visible hit is out of the reader's scope.
      otherWorkspace: [
        otherWorkspaceId,
        seoTaskDescription("markupPercent audit", "seo_audit", PACKET),
      ],
    };
    for (const [key, [inWorkspace, description]] of Object.entries(rows)) {
      const task = await prisma.task.create({
        data: {
          workspaceId: inWorkspace,
          ownerId: inWorkspace === workspaceId ? userId : otherUserId,
          status: TaskStatus.FAILED,
          name: key,
          description,
        },
      });
      ids[key] = task.id;
    }
  });

  afterAll(async () => {
    await prisma.task.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId] } },
    });
    await prisma.coworker.deleteMany({ where: { id: coworkerId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.$disconnect();
  });

  const found = async (where: Parameters<typeof prisma.task.findMany>[0]) =>
    (await prisma.task.findMany({ ...where, select: { name: true } }))
      .map((task) => task.name)
      .sort();

  it("finds a Task by its visible text only, inside the reader's scope", async () => {
    const scope = { workspaceId };
    const [match] = await taskDescriptionMatches(["markupPercent"], scope);
    expect(await found({ where: { AND: [scope, match] } })).toEqual([
      "focused",
      "prose",
      "visible",
    ]);
    // The same filter with no workspace scope still never finds a hidden hit.
    expect(
      await found({
        where: { AND: [{ id: { in: Object.values(ids) } }, match] },
      }),
    ).toEqual(["focused", "prose", "visible"]);
  });

  it("checks every word against the same visible text", async () => {
    const scope = { workspaceId };
    const words = await taskDescriptionMatches(
      ["shop", "markupPercent"],
      scope,
    );
    expect(await found({ where: { AND: [scope, ...words] } })).toEqual([
      "visible",
    ]);
  });

  it("lets the assigned SEO Coworker find its own Task by the line", async () => {
    await prisma.task.update({
      where: { id: ids.hidden },
      data: { assigneeId: coworkerId },
    });
    const scope = { workspaceId };
    const [reader] = await taskDescriptionMatches(["markupPercent"], scope, {
      rawReaderCoworkerId: coworkerId,
    });
    expect(await found({ where: { AND: [scope, reader] } })).toEqual([
      "focused",
      "hidden",
      "prose",
      "visible",
    ]);
    // Another reader still does not find it by the line.
    const [other] = await taskDescriptionMatches(["markupPercent"], scope);
    expect(await found({ where: { AND: [scope, other] } })).not.toContain(
      "hidden",
    );
  });

  it("finds the history row of a Task by its visible text only", async () => {
    const scope = {
      kind: HistoryKind.TASK,
      entityId: { in: Object.values(ids) },
    };
    const match = await historyDescriptionMatch("markupPercent", scope, prisma);
    const history = await prisma.history.findMany({
      where: { AND: [scope, match] },
      select: { entityId: true },
    });
    const names = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [id, name]),
    );
    expect(history.map((row) => names[row.entityId]).sort()).toEqual([
      "focused",
      "otherWorkspace",
      "prose",
      "visible",
    ]);
  });
});
