import type { SokoBotAdminAction } from "@/lib/clients/generated/core";

export type AuditOutcome = "SUCCEEDED" | "FAILED" | "ATTEMPTED";

/**
 * One operator operation as the audit UI presents it. Core writes an
 * `ATTEMPTED` outbox row first and a separate `SUCCEEDED`/`FAILED` row keyed
 * by the same `operationId`; a lone `ATTEMPTED` therefore means the outcome
 * was never recorded (crash/orphan) and needs operator attention.
 */
export interface AuditOperation {
  operationId: string;
  action: string;
  targetId: string | null;
  operatorId: string;
  reason: string;
  outcome: AuditOutcome;
  attemptedAt: Date | null;
  resolvedAt: Date | null;
  errorKind: string | null;
  errorDetail: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  traceId: string | null;
  /** Raw rows behind this operation, oldest first. */
  rows: SokoBotAdminAction[];
}

function terminalRow(rows: SokoBotAdminAction[]): SokoBotAdminAction | null {
  return (
    rows.find((row) => row.status === "SUCCEEDED") ??
    rows.find((row) => row.status === "FAILED") ??
    null
  );
}

/** Group audit rows by `operationId`, newest operation first. */
export function groupAuditOperations(
  actions: readonly SokoBotAdminAction[],
): AuditOperation[] {
  const byOperation = new Map<string, SokoBotAdminAction[]>();
  for (const action of actions) {
    const key = action.operationId || action.id;
    const rows = byOperation.get(key);
    if (rows) rows.push(action);
    else byOperation.set(key, [action]);
  }
  const operations: AuditOperation[] = [];
  for (const [operationId, unsorted] of byOperation) {
    const rows = [...unsorted].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const attempted = rows.find((row) => row.status === "ATTEMPTED") ?? null;
    const terminal = terminalRow(rows);
    const primary = terminal ?? attempted ?? rows[0];
    if (!primary) continue;
    operations.push({
      operationId,
      action: primary.action,
      targetId: primary.targetId,
      operatorId: primary.operatorId,
      reason: primary.reason,
      outcome:
        terminal?.status === "SUCCEEDED"
          ? "SUCCEEDED"
          : terminal?.status === "FAILED"
            ? "FAILED"
            : "ATTEMPTED",
      attemptedAt: attempted?.createdAt ?? rows[0]?.createdAt ?? null,
      resolvedAt: terminal?.createdAt ?? null,
      errorKind: terminal?.errorKind ?? primary.errorKind ?? null,
      errorDetail: terminal?.errorDetail ?? primary.errorDetail ?? null,
      before: terminal?.before ?? attempted?.before,
      after: terminal?.after ?? attempted?.after,
      requestId: primary.requestId,
      traceId: primary.traceId,
      rows,
    });
  }
  return operations.sort((a, b) => {
    const at = a.resolvedAt ?? a.attemptedAt ?? new Date(0);
    const bt = b.resolvedAt ?? b.attemptedAt ?? new Date(0);
    return bt.getTime() - at.getTime();
  });
}
