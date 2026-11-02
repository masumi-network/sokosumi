import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { calendarInvalidationOutboxService } from "@/services/calendar-invalidation-outbox.service";

vi.mock("@/lib/ably/publish", () => ({
  publishCalendarAccessRevoked: vi.fn(),
  publishCalendarInvalidationToUsers: vi.fn(),
}));

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");
const db = enabled && databaseUrl ? createPrismaClient(databaseUrl) : null;

// Run against a disposable database with all migrations applied. Every change
// commits on its own, so each one is its own invalidation.
describe.skipIf(!enabled)("Calendar feature invalidation", () => {
  const suffix = randomUUID();
  let userId = "";
  let organizationId = "";
  let workspaceId = "";
  let projectId = "";
  let newsletterId = "";
  let published = 0;

  beforeAll(async () => {
    if (!db) throw new Error("Missing integration database");
    const user = await db.user.create({
      data: {
        name: "Calendar feature",
        email: `calendar-feature-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    userId = user.id;
    const organization = await db.organization.create({
      data: { name: "Calendar feature", slug: suffix },
    });
    organizationId = organization.id;
    const workspace = await db.workspace.create({
      data: { organizationId },
    });
    workspaceId = workspace.id;
    await db.member.create({
      data: { userId, organizationId, role: "owner" },
    });
    const project = await db.project.create({
      data: { workspaceId, name: "Launch" },
    });
    projectId = project.id;
    const newsletter = await db.newsletter.create({
      data: {
        projectId,
        workspaceId,
        name: "Launch news",
        senderName: "Launch",
        replyTo: "news@example.test",
        publicSlug: `news-${suffix}`,
      },
    });
    newsletterId = newsletter.id;
  });

  afterAll(async () => {
    if (db) {
      await db.newsletterIssue.deleteMany({ where: { workspaceId } });
      await db.socialPost.deleteMany({ where: { workspaceId } });
      await db.newsletter.deleteMany({ where: { workspaceId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
      await db.user.deleteMany({ where: { id: userId } });
      await db.$disconnect();
    }
  });

  /** The invalidations one change writes, and what publishing them bumps. */
  async function signalsOf(change: () => Promise<unknown>) {
    if (!db) throw new Error("Missing integration database");
    const known = await db.calendarInvalidationOutbox.findMany({
      where: { workspaceId },
      select: { id: true, calendarRevision: true },
    });
    const projectBefore = await db.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    await change();
    const rows = await db.calendarInvalidationOutbox.findMany({
      where: { workspaceId, id: { notIn: known.map((row) => row.id) } },
    });
    for (const row of rows) {
      expect(row.calendarRevision).toBeGreaterThan(
        Math.max(0, ...known.map((old) => old.calendarRevision)),
      );
    }
    await calendarInvalidationOutboxService.syncInvalidations({
      shouldContinue: () => true,
      workspaceId,
    });
    const [workspace, project] = await Promise.all([
      db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      db.project.findUniqueOrThrow({ where: { id: projectId } }),
    ]);
    published += rows.length;
    return { rows, workspace, project, projectBefore };
  }

  function expectSignal(
    signal: Awaited<ReturnType<typeof signalsOf>>,
    kind: string,
    options: { project: boolean },
  ) {
    expect(signal.rows).toHaveLength(1);
    const [row] = signal.rows;
    expect(row?.payload).toMatchObject({
      kind,
      projectIds: options.project ? [projectId] : [],
    });
    expect(signal.workspace.calendarRevision).toBe(row?.calendarRevision);
    expect(signal.project.calendarRevision).toBe(
      options.project
        ? row?.calendarRevision
        : signal.projectBefore.calendarRevision,
    );
  }

  it("signals Social post inserts, visible changes and deletes only", async () => {
    if (!db) throw new Error("Missing integration database");
    let postId = "";
    expectSignal(
      await signalsOf(async () => {
        postId = (
          await db.socialPost.create({
            data: {
              workspaceId,
              projectId,
              provider: "x",
              text: "Launch",
              creatorUserId: userId,
            },
          })
        ).id;
      }),
      "social_post_changed",
      { project: true },
    );
    expectSignal(
      await signalsOf(() =>
        db.socialPost.update({
          where: { id: postId },
          data: { scheduledAt: new Date("2026-11-10T09:00:00.000Z") },
        }),
      ),
      "social_post_changed",
      { project: true },
    );
    // Publishing bookkeeping is not on the Calendar.
    expect(
      (
        await signalsOf(() =>
          db.socialPost.update({
            where: { id: postId },
            data: { attemptCount: 1, leaseToken: "lease", lastError: "x" },
          }),
        )
      ).rows,
    ).toHaveLength(0);
    expectSignal(
      await signalsOf(() => db.socialPost.delete({ where: { id: postId } })),
      "social_post_changed",
      { project: true },
    );
  });

  it("signals Newsletter issue inserts and visible changes only", async () => {
    if (!db) throw new Error("Missing integration database");
    let issueId = "";
    expectSignal(
      await signalsOf(async () => {
        issueId = (
          await db.newsletterIssue.create({
            data: {
              newsletterId,
              projectId,
              workspaceId,
              subject: "June update",
              publicSlug: `issue-${suffix}`,
            },
          })
        ).id;
      }),
      "newsletter_issue_changed",
      { project: true },
    );
    expectSignal(
      await signalsOf(() =>
        db.newsletterIssue.update({
          where: { id: issueId },
          data: {
            status: "SCHEDULED",
            scheduledAt: new Date("2026-11-10T09:00:00.000Z"),
          },
        }),
      ),
      "newsletter_issue_changed",
      { project: true },
    );
    expect(
      (
        await signalsOf(() =>
          db.newsletterIssue.update({
            where: { id: issueId },
            data: { previewText: "Read on" },
          }),
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("signals a Contact only while it has a follow-up date", async () => {
    if (!db) throw new Error("Missing integration database");
    let contactId = "";
    expect(
      (
        await signalsOf(async () => {
          contactId = (
            await db.contact.create({ data: { workspaceId, name: "Ada" } })
          ).id;
        })
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await signalsOf(() =>
          db.contact.update({
            where: { id: contactId },
            data: { name: "Ada Lovelace", nextStep: "Call" },
          }),
        )
      ).rows,
    ).toHaveLength(0);
    expectSignal(
      await signalsOf(() =>
        db.contact.update({
          where: { id: contactId },
          data: { followUpAt: new Date("2026-11-10") },
        }),
      ),
      "contact_changed",
      { project: false },
    );
    expectSignal(
      await signalsOf(() =>
        db.contact.update({
          where: { id: contactId },
          data: { nextStep: "Send the offer" },
        }),
      ),
      "contact_changed",
      { project: false },
    );
    // What the Calendar does not show.
    expect(
      (
        await signalsOf(() =>
          db.contact.update({
            where: { id: contactId },
            data: { role: "CTO", interactionCount: 3 },
          }),
        )
      ).rows,
    ).toHaveLength(0);
    expectSignal(
      await signalsOf(() =>
        db.contact.update({
          where: { id: contactId },
          data: { followUpAt: null },
        }),
      ),
      "contact_changed",
      { project: false },
    );
    expect(
      (
        await signalsOf(() =>
          db.contact.update({
            where: { id: contactId },
            data: { name: "Ada L." },
          }),
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("signals a Marketing strategy once approved, and its files", async () => {
    if (!db) throw new Error("Missing integration database");
    const plan = { calendar: [] };
    let strategyId = "";
    expect(
      (
        await signalsOf(async () => {
          strategyId = (
            await db.marketingStrategy.create({ data: { projectId, plan } })
          ).id;
        })
      ).rows,
    ).toHaveLength(0);
    expectSignal(
      await signalsOf(() =>
        db.marketingStrategy.update({
          where: { id: strategyId },
          data: { approvedAt: new Date() },
        }),
      ),
      "marketing_strategy_changed",
      { project: true },
    );
    expectSignal(
      await signalsOf(() =>
        db.marketingStrategy.update({
          where: { id: strategyId },
          data: { plan: { calendar: [], changes: ["Moved"] } },
        }),
      ),
      "marketing_strategy_changed",
      { project: true },
    );

    const file = await db.fileResource.create({
      data: {
        workspaceId,
        sourceKind: "PROJECT_DOCUMENT",
        sourceScope: "ORGANIZATION",
        sourceId: suffix,
        displayName: "June newsletter.md",
        normalizedName: "june newsletter.md",
      },
    });
    expectSignal(
      await signalsOf(() =>
        db.marketingStrategyFile.create({
          data: {
            marketingStrategyId: strategyId,
            entryId: "e1",
            fileResourceId: file.id,
          },
        }),
      ),
      "marketing_strategy_changed",
      { project: true },
    );

    expectSignal(
      await signalsOf(() =>
        db.marketingStrategy.update({
          where: { id: strategyId },
          data: { approvedAt: null },
        }),
      ),
      "marketing_strategy_changed",
      { project: true },
    );
    // A version that is not approved is not on the Calendar.
    expect(
      (
        await signalsOf(() =>
          db.marketingStrategy.update({
            where: { id: strategyId },
            data: { plan: { calendar: [], changes: ["Again"] } },
          }),
        )
      ).rows,
    ).toHaveLength(0);
    expect(published).toBeGreaterThan(0);
  });
});
