"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";
import { coworkerAccessStatusMessageKey } from "@/lib/utils/coworker-access-display";

interface WorkspaceAccessRowProps {
  row: CoworkerWorkspaceAccess;
  /** Translation namespace that includes statusPending|Granted|Denied|Revoked and kind labels. */
  statusNamespace:
    | "App.Developer.Coworkers.EarlyAccess"
    | "App.Admin.Coworkers.Form.EarlyAccess";
  /**
   * When set, GRANTED rows show a Revoke control. Caller handles Core revoke
   * (platform or vendor admin), toasts, and refresh. Reject on failure after
   * reporting the error so this row only clears loading state.
   */
  onRevoke?: (row: CoworkerWorkspaceAccess) => Promise<void>;
}

export function WorkspaceAccessRow({
  row,
  statusNamespace,
  onRevoke,
}: WorkspaceAccessRowProps) {
  const t = useTranslations(statusNamespace);
  const [isRevoking, setIsRevoking] = useState(false);
  const kindLabel =
    row.workspaceKind === "organization"
      ? t("workspaceKindOrganization")
      : t("workspaceKindUser");
  const canRevoke = onRevoke != null && row.status === "GRANTED";

  async function handleRevoke() {
    if (!onRevoke || isRevoking) {
      return;
    }
    setIsRevoking(true);
    try {
      await onRevoke(row);
    } catch {
      // Caller already toasted the detailed error.
      return;
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-5 px-1.5 text-xs font-normal">
            {kindLabel}
          </Badge>
          <span className="text-sm font-medium">
            {row.workspaceDisplayName}
          </span>
        </div>
        <p className="text-muted-foreground truncate font-mono text-xs">
          {row.workspaceDisplayDetail}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Badge variant="secondary" className="h-5 w-fit px-1.5 text-xs">
          {t(coworkerAccessStatusMessageKey(row.status))}
        </Badge>
        {canRevoke ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2.5"
            disabled={isRevoking}
            onClick={() => {
              void handleRevoke();
            }}
          >
            {isRevoking ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("revoke")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
