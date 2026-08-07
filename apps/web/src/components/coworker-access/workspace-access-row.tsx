"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";
import { coworkerAccessStatusMessageKey } from "@/lib/utils/coworker-access-display";

interface WorkspaceAccessRowProps {
  row: CoworkerWorkspaceAccess;
  /** Translation namespace that includes statusPending|Granted|Denied|Revoked and kind labels. */
  statusNamespace:
    | "App.Developer.Coworkers.EarlyAccess"
    | "App.Admin.Coworkers.Form.EarlyAccess";
}

export function WorkspaceAccessRow({
  row,
  statusNamespace,
}: WorkspaceAccessRowProps) {
  const t = useTranslations(statusNamespace);
  const kindLabel =
    row.workspaceKind === "organization"
      ? t("workspaceKindOrganization")
      : t("workspaceKindUser");

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
      <Badge variant="secondary" className="h-5 w-fit shrink-0 px-1.5 text-xs">
        {t(coworkerAccessStatusMessageKey(row.status))}
      </Badge>
    </li>
  );
}
