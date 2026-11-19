import type { Prisma, Task } from "@sokosumi/database";
import { conflict } from "@/helpers/error";
import { isPrismaTransactionConflict } from "@/helpers/prisma";
import {
  readSeoTaskStartAnalysis,
  requireSeoTaskStartBalance,
} from "@/lib/seo/analysis-price";
import {
  type AuthenticationContext,
  isAgentAuthContext,
} from "@/middleware/auth";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { storedSeoAuditSearchConsoleSchema } from "@/schemas/seo-task-indexing.schema";
import { requireLockedSeoOwner, sha256 } from "./project-seo-store";
import {
  type AuditSearchConsoleProof,
  assertAuditSearchConsoleCurrent,
  checkAuditSearchConsole,
} from "./seo-audit-search-console";
import { readApprovedSeoTaskPages } from "./seo-task-audit-context";

function reviewAudit() {
  return conflict("Review the audit in the SEO workspace before it starts.");
}

interface SeoAuditStartCheck {
  actor: SeoActor;
  pages: { id: string; url: string }[];
  access: AuditSearchConsoleProof;
  fingerprint: string;
}

/** Both event transactions check the frozen Run, the current owner and the approved connection. */
export async function requiredSeoAuditStartCheck(
  tx: Prisma.TransactionClient,
  task: Task,
  auth: AuthenticationContext,
  verified?: string,
): Promise<SeoAuditStartCheck | null> {
  const analysis = await readSeoTaskStartAnalysis(tx, task.id);
  const stored =
    analysis?.kind === "audit_full"
      ? storedSeoAuditSearchConsoleSchema.safeParse(analysis.request)
      : null;
  if (stored && !stored.success) throw reviewAudit();
  const access = stored?.data.searchConsoleAccess;
  // A public Task must give a collaborator the same answer for private coverage and for a limited audit.
  if (analysis && access !== undefined) {
    const assignedWorker =
      auth.actor === "coworker" &&
      !auth.context &&
      auth.coworkerId === task.assigneeId;
    const owner = auth.actor === "user" && auth.userId === task.ownerId;
    if (
      (!assignedWorker && !owner) ||
      analysis.requestedBy !== task.ownerId ||
      (analysis.auditId === null) === (analysis.projectId === null)
    )
      throw reviewAudit();
  }
  // Workers always need the approved price. A manual RUNNING transition also checks a verified audit.
  if (isAgentAuthContext(auth) || access !== undefined)
    await requireSeoTaskStartBalance(tx, task, analysis);
  if (!analysis || !access) {
    if (verified) throw reviewAudit();
    return null;
  }
  const actor: SeoActor = {
    owner: analysis.auditId
      ? { kind: "audit", id: analysis.auditId }
      : { kind: "project", id: analysis.projectId! },
    workspaceId: task.workspaceId,
    userId: analysis.requestedBy,
    organizationId: task.organizationId,
  };
  try {
    const owner = await requireLockedSeoOwner(tx, actor, false);
    if (owner.projectId !== task.projectId) throw reviewAudit();
    const { pages } = await readApprovedSeoTaskPages(tx, actor, analysis);
    await assertAuditSearchConsoleCurrent(actor, access, tx);
    const fingerprint = sha256(
      JSON.stringify([
        task.id,
        task.status,
        task.scheduleId,
        task.assigneeId,
        task.description,
        actor,
        analysis.requestHash,
        pages,
        access,
      ]),
    );
    if (!verified) return { actor, pages, access, fingerprint };
    if (verified !== fingerprint) throw reviewAudit();
    return null;
  } catch (error) {
    if (isPrismaTransactionConflict(error)) throw error;
    throw reviewAudit();
  }
}

/** Read Google between transactions. Keep the owner’s access details out of the worker response. */
export async function verifySeoAuditStart(
  check: SeoAuditStartCheck,
): Promise<string> {
  try {
    await checkAuditSearchConsole(
      check.actor,
      check.pages,
      check.access.propertyId,
      check.access.connectionVersion,
    );
    return check.fingerprint;
  } catch {
    throw reviewAudit();
  }
}
