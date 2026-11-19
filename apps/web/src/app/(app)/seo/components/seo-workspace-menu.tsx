"use client";

import {
  Archive,
  Lightbulb,
  ListPlus,
  MoreHorizontal,
  PencilLine,
  Plus,
  Settings2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useArchiveSeoAudit } from "./use-archive-seo-audit";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

interface SeoArchiveAuditDialogProps {
  auditId: string;
  name: string;
  projectId: string | null;
  onClose: () => void;
  onReturnFocus: () => void;
}

function SeoArchiveAuditDialog({
  auditId,
  name,
  projectId,
  onClose,
  onReturnFocus,
}: SeoArchiveAuditDialogProps) {
  const t = useTranslations("App.Seo");
  const archive = useArchiveSeoAudit(auditId, projectId);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !archive.pending) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <AlertDialogHeader className="min-w-0">
          <AlertDialogTitle className="min-w-0 [overflow-wrap:anywhere]">
            {t("audits.archiveTitle", { name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("audits.archiveDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {archive.error ? (
          <p role="alert" className="text-destructive text-sm">
            {t(`audits.${archive.error}`)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={archive.pending}>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={archive.error === "archiveUnavailable"}
            loading={archive.pending}
            onClick={(event) => {
              event.preventDefault();
              archive.confirm();
            }}
          >
            {t("audits.archive")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SeoWorkspaceMenu({
  model,
  unavailable,
}: {
  model: SeoWorkspaceModel;
  unavailable: boolean;
}) {
  const t = useTranslations("App.Seo");
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const manageTrigger = useRef<HTMLButtonElement>(null);
  const { auditId, auditName, projectId } = model.data;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* The trigger shows only its icon: the run leads the checks card under the header. An icon-only
              control is 40 px below md. */}
          <Button
            ref={manageTrigger}
            variant="outline"
            size="sm"
            title={t("manage")}
            className="max-md:min-h-10 max-md:min-w-10"
          >
            <MoreHorizontal className="size-4" />
            <span className="sr-only">{t("manage")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (confirmingArchive) event.preventDefault();
          }}
        >
          {model.data.availableActions.canEdit ? (
            <DropdownMenuItem
              disabled={unavailable}
              onSelect={() => model.setDialog("brief")}
            >
              <PencilLine className="size-4" />
              {t("brief.title")}
            </DropdownMenuItem>
          ) : null}
          {model.data.availableActions.canSyncMetrics ? (
            <DropdownMenuItem
              disabled={unavailable}
              onSelect={() => model.setDialog("statistics")}
            >
              <Settings2 className="size-4" />
              {t("manageStatistics")}
            </DropdownMenuItem>
          ) : null}
          {model.data.availableActions.canEdit ? (
            <>
              <DropdownMenuItem
                disabled={unavailable}
                onSelect={() => model.setDialog("page")}
              >
                <Plus className="size-4" />
                {t("addPage")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={unavailable || !model.data.pages.length}
                onSelect={() => model.setDialog("scope")}
              >
                <ListPlus className="size-4" />
                {t("createScope")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={unavailable || !model.data.scope.pageIds.length}
                onSelect={() => model.setDialog("page_change")}
              >
                <PencilLine className="size-4" />
                {t("pageChange.title")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem
            disabled={unavailable}
            onSelect={() => model.setDialog("improve")}
          >
            <Lightbulb className="size-4" />
            {t("improve.catalog.title")}
          </DropdownMenuItem>
          {auditId ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setConfirmingArchive(true)}>
                <Archive aria-hidden />
                {t("audits.archive")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmingArchive && auditId ? (
        <SeoArchiveAuditDialog
          auditId={auditId}
          name={auditName ?? ""}
          projectId={projectId ?? null}
          onClose={() => setConfirmingArchive(false)}
          onReturnFocus={() => manageTrigger.current?.focus()}
        />
      ) : null}
    </>
  );
}
