import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
} from "./project-seo.service";
import { recordProjectSeoPageChange } from "./project-seo-page-changes.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID(),
  workspaceId = randomUUID(),
  projectId = randomUUID();
const actor: SeoActor = {
  projectId,
  workspaceId,
  userId,
  organizationId: null,
};

describe.skipIf(!enabled)("manual SEO page changes with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Page change fixture",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.project.create({
      data: { id: projectId, workspaceId, name: "Page change fixture" },
    });
  });
  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });
  it("records one immutable scoped timeline event across retries, with conflicting retries refused", async () => {
    const first = await addProjectSeoPage(actor, {
      url: "https://example.test/one",
      relationship: "primary",
    });
    const second = await addProjectSeoPage(actor, {
      url: "https://example.test/two",
      relationship: "related",
      relatedToPageId: first.id,
    });
    const input = {
      pageIds: [first.id],
      occurredAt: new Date().toISOString(),
      title: "Updated the page title",
      note: "Released a new title after review. Traffic effect is not yet measured.",
      idempotencyKey: randomUUID(),
    };
    const recorded = await recordProjectSeoPageChange(actor, input);
    expect((await recordProjectSeoPageChange(actor, input)).id).toBe(
      recorded.id,
    );
    expect(
      await prisma.projectSeoObservation.count({
        where: { projectId, kind: "page_change" },
      }),
    ).toBe(1);
    await expect(
      recordProjectSeoPageChange(actor, {
        ...input,
        title: "Different change",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const workspace = await getProjectSeoWorkspace(actor, { pageId: first.id });
    expect(
      workspace.timeline.filter((event) => event.kind === "page_change"),
    ).toEqual([
      expect.objectContaining({
        title: input.title,
        detail: input.note,
        status: "recorded",
        pageIds: [first.id],
      }),
    ]);
    expect(
      (
        await getProjectSeoWorkspace(actor, { pageId: second.id })
      ).timeline.some((event) => event.kind === "page_change"),
    ).toBe(false);
    expect(workspace.actions).toEqual([]);
  });
  it("refuses foreign pages, future changes and cancelled bot writes before any durable event", async () => {
    const page = await addProjectSeoPage(actor, {
      url: "https://example.test/one",
      relationship: "primary",
    });
    const input = {
      pageIds: [page.id],
      occurredAt: new Date().toISOString(),
      title: "Changed copy",
      note: "",
      idempotencyKey: randomUUID(),
    };
    const before = await prisma.projectSeoObservation.count({
      where: { projectId },
    });
    await expect(
      recordProjectSeoPageChange(actor, { ...input, pageIds: [randomUUID()] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      recordProjectSeoPageChange(actor, {
        ...input,
        occurredAt: "2099-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      recordProjectSeoPageChange(actor, input, {
        authorize: async () => {
          throw new Error("Turn cancelled");
        },
      }),
    ).rejects.toThrow("Turn cancelled");
    expect(
      await prisma.projectSeoObservation.count({ where: { projectId } }),
    ).toBe(before);
  });
});
