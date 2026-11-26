import { expect, it, vi } from "vitest";

import type { SeoActor } from "@/schemas/project-seo.schema";
import { readPublicAuditSitemaps } from "./seo-audit-public-sitemaps";

const db = vi.hoisted(() => ({ observations: vi.fn(), files: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSeoObservation: { findMany: db.observations },
    taskFile: { findMany: db.files },
  },
}));
const actor = {
  userId: "human",
  workspaceId: "work",
  owner: { kind: "audit", id: "audit" },
} as SeoActor;
it("requires an imported file key and a matching completed public task before using a root", async () => {
  const root = "https://shop.test/maps/main.xml";
  const row = {
    sourceTaskId: "task",
    sourceFileId: "file",
    sourceKey: "task-file:file",
    payload: {
      kind: "audit_full",
      version: 1,
      pageUrls: ["https://shop.test/"],
      publicSitemaps: [root],
    },
  };
  db.observations.mockResolvedValue([
    row,
    {
      ...row,
      sourceTaskId: "wrong",
      sourceFileId: "other",
      sourceKey: "task-file:other",
    },
  ]);
  db.files.mockResolvedValue([
    { id: "file", taskId: "task" },
    { id: "other", taskId: "task" },
  ]);
  expect(await readPublicAuditSitemaps(actor, ["task", "wrong"])).toEqual(
    new Map([["task", [root]]]),
  );
  expect(db.observations.mock.calls[0]?.[0].where).toMatchObject({
    auditId: "audit",
    projectId: null,
    ownerId: null,
    kind: "audit_full",
    source: "seo_coworker",
  });
  // The reader need not own the Task: a colleague sees the same roots for a public audit.
  expect(db.files.mock.calls[0]?.[0].where.task).toEqual({
    id: { in: ["task", "wrong"] },
    workspaceId: "work",
    status: "COMPLETED",
    visibility: "PUBLIC",
    archivedAt: null,
  });
  db.observations.mockResolvedValue([
    { ...row, sourceKey: "task-file:foreign" },
  ]);
  expect(await readPublicAuditSitemaps(actor, ["task"])).toEqual(new Map());
  expect(db.files).toHaveBeenCalledTimes(1);
});
