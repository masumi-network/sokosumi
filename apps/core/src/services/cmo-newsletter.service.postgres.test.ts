import { randomUUID } from "node:crypto";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import { putNewsletter } from "@/services/newsletter.service";
import { createNewsletterIssue } from "@/services/newsletter-issues.service";

import { prepareCalendarNewsletterIssue } from "./cmo-newsletter.service";

const mocks = vi.hoisted(() => ({
  readCopy: vi.fn(),
  enabled: vi.fn(async () => true),
}));

vi.mock("@/services/marketing-strategy-files.service", () => ({
  readMarketingPieceText: mocks.readCopy,
}));
vi.mock("@/lib/newsletter/feature", () => ({
  isNewsletterWorkspaceEnabled: mocks.enabled,
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const organizationId = randomUUID();
const workspaceId = randomUUID();
const projectId = randomUUID();
const strategyId = randomUUID();
const userId = randomUUID();
const scope = { projectId, workspaceId };
const plan = { userId, projectId, strategyId };

describe.runIf(enabled)("CMO calendar newsletter on PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Newsletter Calendar",
        email: `calendar-newsletter-${userId}@sokosumi.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        slug: `calendar-newsletter-${organizationId}`,
        name: "Newsletter Calendar",
        createdAt: new Date(),
        members: {
          create: {
            id: randomUUID(),
            userId,
            role: "owner",
            createdAt: new Date(),
          },
        },
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        workspaceId,
        name: "Newsletter Calendar",
        identifier: "NEWS",
      },
    });
    await prisma.sokoBot.create({
      data: { projectId, workspaceId, versionId: CMO_SOKO_BOT_VERSION_ID },
    });
    await putNewsletter(scope, {
      name: "Newsletter Calendar",
      senderName: "Newsletter Calendar",
      replyTo: "calendar@sokosumi.test",
      brand: {},
      welcomeEmailEnabled: false,
    });

    const entryIds = ["new", "existing", "conflict", "changed", "article"];
    await prisma.marketingStrategy.create({
      data: {
        id: strategyId,
        projectId,
        approvedAt: new Date(),
        plan: {
          month: "2026-11",
          summary: "Share our launch",
          goals: ["Reach existing customers"],
          pillars: [{ name: "Product", share: 100 }],
          channels: [{ channel: "newsletter", cadence: "Weekly" }],
          calendar: entryIds.map((id) => ({
            id,
            channel: id === "article" ? "seo" : "newsletter",
            format: id === "article" ? "article" : "newsletter",
            title: "November launch",
            date: "2026-11-10",
            status: "draft",
          })),
        },
      },
    });
    for (const entryId of entryIds) {
      const { id: fileResourceId } = await prisma.fileResource.create({
        data: {
          workspaceId,
          ownerOrganizationId: organizationId,
          sourceKind: "DRIVE_UPLOAD",
          sourceScope: "ORGANIZATION",
          sourceId: `fixture/${organizationId}/${entryId}.md`,
          displayName: `${entryId}.md`,
          normalizedName: `${entryId}.md`,
          lifecycle: "ACTIVE",
        },
        select: { id: true },
      });
      await prisma.marketingStrategyFile.create({
        data: { marketingStrategyId: strategyId, entryId, fileResourceId },
      });
    }
  });

  afterAll(async () => {
    await prisma.newsletter.deleteMany({ where: scope });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("links one draft even when requests race and preserves subsequent edits", async () => {
    mocks.readCopy.mockResolvedValue(
      "Subject: The launch is here\r\nPreview: See what changed\r\n\r\nHi there.\r\n\r\n## What changed\r\n[See the launch](https://example.com/launch)",
    );
    const input = { ...plan, entryId: "new" };
    const [first, second] = await Promise.all([
      prepareCalendarNewsletterIssue(input),
      prepareCalendarNewsletterIssue(input),
    ]);
    expect(second).toBe(first);
    expect(
      await prisma.newsletterIssue.findMany({ where: scope }),
    ).toMatchObject([
      {
        id: first,
        status: "DRAFT",
        subject: "The launch is here",
        previewText: "See what changed",
        content: [
          { type: "text", text: "Hi there." },
          { type: "heading", text: "What changed", level: 2 },
          {
            type: "text",
            text: "[See the launch](https://example.com/launch)",
          },
        ],
      },
    ]);
    await prisma.newsletterIssue.update({
      where: { id: first },
      data: { subject: "Edited by the reviewer" },
    });
    mocks.readCopy.mockClear();
    expect(await prepareCalendarNewsletterIssue(input)).toBe(first);
    expect(mocks.readCopy).not.toHaveBeenCalled();
    expect(
      await prisma.newsletterIssue.findUnique({ where: { id: first } }),
    ).toMatchObject({
      subject: "Edited by the reviewer",
    });
  });

  it("reuses an existing draft and rejects linking it to another piece", async () => {
    const { id: issueId } = await createNewsletterIssue(scope, {
      subject: "Already written",
      template: "TEXT",
      content: [{ type: "text", text: "A saved newsletter." }],
    });
    await expect(
      prepareCalendarNewsletterIssue({ ...plan, entryId: "existing", issueId }),
    ).resolves.toBe(issueId);
    await expect(
      prepareCalendarNewsletterIssue({ ...plan, entryId: "conflict", issueId }),
    ).rejects.toThrow("already linked to another calendar piece");
  });

  it("refuses copy replaced in Drive while the draft is being prepared", async () => {
    const entryId = "changed";
    const piece = await prisma.marketingStrategyFile.findUniqueOrThrow({
      where: {
        marketingStrategyId_entryId: {
          marketingStrategyId: strategyId,
          entryId,
        },
      },
    });
    mocks.readCopy.mockImplementationOnce(async () => {
      await prisma.fileResource.update({
        where: { id: piece.fileResourceId },
        data: { contentRevision: { increment: 1 } },
      });
      return "Subject: Previous version\n\nThe old copy.";
    });

    await expect(
      prepareCalendarNewsletterIssue({ ...plan, entryId }),
    ).rejects.toThrow("calendar draft changed");
    expect(
      await prisma.newsletterIssue.findFirst({
        where: { ...scope, subject: "Previous version" },
      }),
    ).toBeNull();
  });

  it("refuses old bytes when a reserved Drive revision activates during the read", async () => {
    const entryId = "changed";
    const piece = await prisma.marketingStrategyFile.findUniqueOrThrow({
      where: {
        marketingStrategyId_entryId: {
          marketingStrategyId: strategyId,
          entryId,
        },
      },
      include: { fileResource: true },
    });
    mocks.readCopy.mockImplementationOnce(async () => {
      await prisma.fileResource.update({
        where: { id: piece.fileResourceId },
        data: {
          updatedAt: new Date(piece.fileResource.updatedAt.getTime() + 1000),
        },
      });
      return "Subject: Old upload bytes\n\nThe old copy.";
    });

    await expect(
      prepareCalendarNewsletterIssue({ ...plan, entryId }),
    ).rejects.toThrow("calendar draft changed");
    expect(
      await prisma.newsletterIssue.findFirst({
        where: { ...scope, subject: "Old upload bytes" },
      }),
    ).toBeNull();
  });

  it("rejects stale calendars and non-newsletter pieces", async () => {
    await expect(
      prepareCalendarNewsletterIssue({
        ...plan,
        strategyId: randomUUID(),
        entryId: "new",
      }),
    ).rejects.toThrow("approved calendar changed");
    await expect(
      prepareCalendarNewsletterIssue({ ...plan, entryId: "article" }),
    ).rejects.toThrow("Newsletter calendar piece not found");
  });
});
