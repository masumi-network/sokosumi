import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import { setSeoAuditArchivedAction } from "@/lib/actions/seo/set-audit-archived";

type ConflictMessage =
  | "archiveActiveCheck"
  | "archiveActiveChat"
  | "archiveScheduled"
  | "taskScopeConflict";
const conflictMessages = new Map<string, ConflictMessage>([
  [CORE_API_ERROR_KINDS.SEO_AUDIT_ACTIVE_CHECK, "archiveActiveCheck"],
  [CORE_API_ERROR_KINDS.SEO_AUDIT_ACTIVE_CHAT, "archiveActiveChat"],
  [CORE_API_ERROR_KINDS.SEO_AUDIT_RESUMABLE_MONITOR, "archiveScheduled"],
  [CORE_API_ERROR_KINDS.SEO_AUDIT_TASK_SCOPE_CONFLICT, "taskScopeConflict"],
]);
type ArchiveError =
  | ConflictMessage
  | "archiveTaskBlocked"
  | "archiveBlocked"
  | "archiveUnavailable"
  | "archiveFailed";

export function useArchiveSeoAudit(auditId: string, projectId: string | null) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ArchiveError | null>(null);

  function confirm() {
    startTransition(async () => {
      setError(null);
      try {
        const result = await setSeoAuditArchivedAction({
          auditId,
          projectId,
          archived: true,
        });
        if (!result.ok) {
          const { status, kind } = result.error;
          setError(
            status === 409
              ? (conflictMessages.get(kind ?? "") ?? "archiveBlocked")
              : status === 422
                ? "archiveTaskBlocked"
                : status === 403 || status === 404
                  ? "archiveUnavailable"
                  : "archiveFailed",
          );
        }
      } catch (cause) {
        unstable_rethrow(cause);
        setError("archiveFailed");
      }
    });
  }

  return { confirm, error, pending };
}
