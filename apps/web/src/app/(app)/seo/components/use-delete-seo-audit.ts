import type { SeoAuditSummary } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { deleteSeoAuditAction } from "@/lib/actions/seo/delete-audit";
import { seoIndexHref } from "../seo-href";

export const auditLinkId = (id: string) => `seo-audit-link-${id}`;
export const auditMenuId = (id: string) => `seo-audit-options-${id}`;
export const AUDIT_LIST_MORE_ID = "seo-audit-list-more";
export const AUDIT_LIST_RETURN_ID = "seo-audit-list-return";
const EMPTY_AUDIT_URL_ID = "seo-audit-url";

type ConflictMessage =
  | "deleteActiveCheck"
  | "deleteActiveChat"
  | "deleteScheduled";
const conflictMessages = new Map<string, ConflictMessage>([
  [CORE_API_ERROR_KINDS.SEO_AUDIT_ACTIVE_CHECK, "deleteActiveCheck"],
  [CORE_API_ERROR_KINDS.SEO_AUDIT_ACTIVE_CHAT, "deleteActiveChat"],
  [CORE_API_ERROR_KINDS.SEO_AUDIT_RESUMABLE_MONITOR, "deleteScheduled"],
]);
type DeleteError =
  | ConflictMessage
  | "deleteBlocked"
  | "deleteUnavailable"
  | "deleteFailed";

/** Removes only server-confirmed rows while the revalidated index is on the way. */
export function useDeleteSeoAudit(
  audits: SeoAuditSummary[],
  cursor: string | null,
  nextCursor: string | null,
  projectId: string | null,
) {
  const router = useRouter();
  const mounted = useRef(false);
  const submitting = useRef(false);
  const focusTarget = useRef<string | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [selected, select] = useState<SeoAuditSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DeleteError | null>(null);
  const rows = audits.filter((audit) => !removed.includes(audit.id));
  useMountEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  });

  function open(audit: SeoAuditSummary) {
    if (submitting.current || audit.canDelete !== true) return;
    focusTarget.current = auditMenuId(audit.id);
    setError(null);
    select(audit);
  }

  function close() {
    if (!submitting.current) select(null);
  }

  function restoreFocus() {
    const id = focusTarget.current;
    focusTarget.current = null;
    if (id) {
      const target =
        document.getElementById(id) ??
        document.getElementById(AUDIT_LIST_RETURN_ID) ??
        document.getElementById(EMPTY_AUDIT_URL_ID) ??
        (rows[0] && document.getElementById(auditLinkId(rows[0].id)));
      target?.focus();
    }
  }

  async function confirm() {
    if (!selected || submitting.current) return;
    const index = rows.findIndex((row) => row.id === selected.id);
    if (rows[index]?.canDelete !== true) {
      setError("deleteUnavailable");
      return;
    }
    const next = rows[index + 1] ?? rows[index - 1];
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await deleteSeoAuditAction({ auditId: selected.id });
      if (!mounted.current) return;
      if (!result.ok) {
        const status = result.error.status;
        setError(
          status === 409
            ? (conflictMessages.get(result.error.kind ?? "") ?? "deleteBlocked")
            : status === 403 || status === 404
              ? "deleteUnavailable"
              : "deleteFailed",
        );
        return;
      }
      focusTarget.current = next
        ? auditLinkId(next.id)
        : nextCursor
          ? AUDIT_LIST_MORE_ID
          : EMPTY_AUDIT_URL_ID;
      setRemoved((previous) => [...previous, selected.id]);
      select(null);
      if (!next && cursor && !nextCursor)
        router.replace(seoIndexHref(projectId));
    } catch {
      if (mounted.current) setError("deleteFailed");
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return {
    rows,
    selected,
    error,
    pending,
    open,
    close,
    confirm,
    restoreFocus,
  };
}
