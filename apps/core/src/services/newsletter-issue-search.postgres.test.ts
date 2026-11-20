import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { listNewsletterSubscribers } from "./newsletter.service";
import { listNewsletterIssues } from "./newsletter-issues.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID();
const workspaceId = randomUUID();
const projectId = randomUUID();
const scope = { workspaceId, projectId };

describe.skipIf(!enabled)("Newsletter issue search", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Issue search",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.project.create({
      data: { id: projectId, workspaceId, name: "Issue search" },
    });
    const newsletter = await prisma.newsletter.create({
      data: {
        ...scope,
        name: "Updates",
        senderName: "Editor",
        replyTo: "editor@example.test",
        publicSlug: randomUUID(),
      },
    });
    await prisma.newsletterSubscriber.createMany({
      data: ["Ada_Fifty", "AdaxFifty"].map((name, index) => ({
        newsletterId: newsletter.id,
        name,
        email: `subscriber-${index}@example.test`,
      })),
    });
    await prisma.newsletterIssue.createMany({
      data: [
        { subject: "50%_release notes", createdAt: new Date("2026-01-01") },
        {
          subject: "Body",
          content: [
            {
              type: "columns",
              columns: [{ text: "50%_Release" }, { text: "Later" }],
            },
          ],
        },
        {
          subject: "Teaser",
          previewText: "50%_release",
          createdAt: new Date("2026-01-02"),
        },
        {
          subject: "50th release",
          content: [
            {
              type: "image",
              url: "https://example.test/50%_release",
              alt: "Illustration",
            },
          ],
        },
        { subject: "Sent 50%_release", status: "SENT" as const },
      ].map((issue) => ({
        ...scope,
        newsletterId: newsletter.id,
        publicSlug: randomUUID(),
        ...issue,
      })),
    });
  });
  afterAll(async () => {
    await prisma.newsletter.deleteMany({ where: scope });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("searches an unlinked subscriber's displayed name and treats punctuation literally", async () => {
    const result = await listNewsletterSubscribers(scope, {
      search: "ada_fifty",
      limit: 5,
    });
    expect(result.subscribers.map((subscriber) => subscriber.name)).toEqual([
      "Ada_Fifty",
    ]);
    expect(result.pagination.total).toBe(1);
  });

  it("returns older subject matches first, then body and preview matches, without searching block URLs", async () => {
    const query = { search: "50%_release", limit: 2, status: "DRAFT" as const };
    const first = await listNewsletterIssues(scope, query);
    expect(first.issues.map(({ subject }) => subject)).toEqual([
      "50%_release notes",
      "Body",
    ]);
    expect(first.pagination.total).toBe(3);
    expect(first.pagination.nextCursor).toBeTruthy();
    const next = await listNewsletterIssues(scope, {
      ...query,
      cursor: first.pagination.nextCursor!,
    });
    expect(next.issues.map(({ subject }) => subject)).toEqual(["Teaser"]);
    expect(next.pagination.nextCursor).toBeNull();
  });
});
