import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { conflict } from "@/helpers/error";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { seoAuditSearchConsoleAccessSchema } from "@/schemas/seo-task-indexing.schema";
import { seoOwnerWhere, sha256 } from "./project-seo-store";
import {
  type AuditSearchConsoleProof,
  assertAuditSearchConsoleCurrent,
} from "./seo-audit-search-console";

export type ManualSeoRunApproval =
  | {
      access: AuditSearchConsoleProof | null;
      pages: { id: string; url: string }[];
    }
  | "cmo-subscription";

const monitorApprovalSchema = z.object({
  searchConsoleAccess: seoAuditSearchConsoleAccessSchema.nullable(),
});

function approvalWhere(actor: SeoActor, scheduleId: string) {
  return {
    ...seoOwnerWhere(actor),
    ownerId: actor.userId,
    visibility: "PRIVATE",
    kind: "monitor_approval",
    source: "user",
    sourceKey: `monitor-approval:${scheduleId}`,
  };
}

export async function saveMonitorSearchConsoleApproval(
  tx: Prisma.TransactionClient,
  actor: SeoActor,
  scheduleId: string,
  pageIds: string[],
  scopeVersion: number,
  access: AuditSearchConsoleProof | null,
) {
  if (access) await assertAuditSearchConsoleCurrent(actor, access, tx);
  const payload = { searchConsoleAccess: access ? { ...access } : null };
  await tx.projectSeoObservation.create({
    data: {
      ...approvalWhere(actor, scheduleId),
      pageIds,
      scopeVersion,
      payload,
      artifactHash: sha256(JSON.stringify(payload)),
      observedAt: new Date(),
    },
  });
}

/** A scheduled or manual Run inherits the exact selection approved when its monitor was created. */
export async function readMonitorSearchConsoleApproval(
  tx: Prisma.TransactionClient,
  actor: SeoActor,
  scheduleId: string,
) {
  const saved = await tx.projectSeoObservation.findFirst({
    where: approvalWhere(actor, scheduleId),
    select: { payload: true },
  });
  const result = monitorApprovalSchema.safeParse(saved?.payload);
  if (!result.success)
    throw conflict(
      "The saved Search Console approval is unavailable. Review coverage before running this audit.",
      { kind: CORE_API_ERROR_KINDS.SEO_GSC_UNAVAILABLE },
    );
  return result.data.searchConsoleAccess;
}
