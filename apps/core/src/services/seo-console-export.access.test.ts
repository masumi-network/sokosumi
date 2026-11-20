import { expect, it, vi } from "vitest";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { consoleExports } from "./seo-console-export";

const tx = vi.hoisted(() => ({
  projectSeoAnalysis: {
    findUnique: () => ({
      taskId: "task",
      requestedBy: "alice",
      kind: "audit_full",
      auditId: "audit",
      projectId: null,
    }),
  },
  task: {
    findUnique: () => ({
      status: "COMPLETED",
      ownerId: "alice",
      workspaceId: "workspace",
      organizationId: "org",
      projectId: null,
    }),
  },
  projectSeoObservation: { findMany: vi.fn(), create: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: (run: (client: typeof tx) => unknown) => run(tx) },
}));

const owner: SeoActor = {
  workspaceId: "workspace",
  organizationId: "org",
  userId: "alice",
  owner: { kind: "audit", id: "audit" },
};
it("refuses a teammate, a different audit, and a delegated bot before reading or writing private CSV rows", async () => {
  for (const actor of [
    { ...owner, userId: "teammate" },
    { ...owner, owner: { kind: "audit" as const, id: "other" } },
    { ...owner, sokoBotId: "bot", privateMetricsAllowed: true },
  ]) {
    await expect(consoleExports(actor, "task")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      consoleExports(actor, "task", {
        kind: "linked_pages",
        date: "2026-01-01",
        csv: "a",
      }),
    ).rejects.toMatchObject({ status: 404 });
  }
  expect(tx.projectSeoObservation.findMany).not.toHaveBeenCalled();
  expect(tx.projectSeoObservation.create).not.toHaveBeenCalled();
});
