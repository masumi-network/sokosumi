"use client";

import {
  Archive,
  ChartNoAxesCombined,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MIN_PAGES_FOR_SELECTIONS } from "./seo-pages";
import { SeoReportFileSelection } from "./seo-report-files";
import { useArchiveSeoAudit } from "./use-archive-seo-audit";
import type { SeoReportFileProps } from "./use-seo-report-files";
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
  versions,
}: {
  versions: SeoReportFileProps["versions"];
  model: SeoReportFileProps["model"] & Pick<SeoWorkspaceModel, "setDialog">;
  unavailable: boolean;
}) {
  const t = useTranslations("App.Seo");
  const [showResults, setShowResults] = useState(false);
  const consoleVersions = versions.filter(
    (v) =>
      v.kind === "audit_full" ||
      model.data.auditSearchConsole?.some((e) => e.taskId === v.taskId) ||
      model.data.auditSearchConsoleRetryTaskIds?.includes(v.taskId),
  );
  if (showResults && !consoleVersions.length) setShowResults(false);
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
            if (confirmingArchive || showResults) event.preventDefault();
          }}
        >
          {(consoleVersions.length > 0 ||
            model.data.availableActions.canSyncMetrics) && (
            <>
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {t("menu.google")}
              </DropdownMenuLabel>
              {consoleVersions.length > 0 && (
                <DropdownMenuItem
                  disabled={unavailable}
                  onSelect={() => setShowResults(true)}
                >
                  <ChartNoAxesCombined aria-hidden />
                  {t("reportFiles.consoleResults")}
                </DropdownMenuItem>
              )}
              {model.data.availableActions.canSyncMetrics ? (
                <DropdownMenuItem
                  disabled={unavailable}
                  onSelect={() => model.setDialog("statistics")}
                >
                  <Settings2 className="size-4" />
                  {t("manageStatistics")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            {t("menu.audit")}
          </DropdownMenuLabel>
          {model.data.availableActions.canEdit ? (
            <DropdownMenuItem
              disabled={unavailable}
              onSelect={() => model.setDialog("brief")}
            >
              <PencilLine className="size-4" />
              {t("brief.title")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={unavailable}
            onSelect={() => model.setDialog("improve")}
          >
            <Lightbulb className="size-4" />
            {t("improve.catalog.title")}
          </DropdownMenuItem>
          {model.data.availableActions.canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {t("pages.title")}
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={unavailable}
                onSelect={() => model.setDialog("page")}
              >
                <Plus className="size-4" />
                {t("addPage")}
              </DropdownMenuItem>
              {model.data.pages.length >= MIN_PAGES_FOR_SELECTIONS && (
                <DropdownMenuItem
                  disabled={unavailable}
                  onSelect={() => model.setDialog("scope")}
                >
                  <ListPlus className="size-4" />
                  {t("createScope")}
                </DropdownMenuItem>
              )}
              {model.data.scope.pageIds.length > 0 && (
                <DropdownMenuItem
                  disabled={unavailable}
                  onSelect={() => model.setDialog("page_change")}
                >
                  <PencilLine className="size-4" />
                  {t("pageChange.title")}
                </DropdownMenuItem>
              )}
            </>
          ) : null}
          {auditId ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmingArchive(true)}
              >
                <Archive aria-hidden />
                {t("audits.archive")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {showResults && consoleVersions.length > 0 && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setShowResults(false);
          }}
        >
          <DialogContent
            aria-describedby={undefined}
            className="max-h-[85dvh] grid-cols-1 overflow-y-auto"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              manageTrigger.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("reportFiles.consoleResults")}</DialogTitle>
            </DialogHeader>
            <SeoReportFileSelection
              model={model}
              versions={consoleVersions}
              view="console"
            />
          </DialogContent>
        </Dialog>
      )}
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
