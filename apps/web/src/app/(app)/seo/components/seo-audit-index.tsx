"use client";

import type { SeoAuditSummary } from "@sokosumi/core-client";
import {
  ArrowUpRight,
  Ellipsis,
  Plus,
  SearchCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { seoAuditHref, seoIndexHref, seoProjectHref } from "../seo-href";
import { SeoAuditForm } from "./seo-audit-form";
import { SeoAuditOnboarding } from "./seo-audit-onboarding";
import { SeoDate, SeoSection } from "./seo-shared";
import { useCreateSeoAudit } from "./use-create-seo-audit";
import {
  AUDIT_LIST_MORE_ID,
  AUDIT_LIST_RETURN_ID,
  auditLinkId,
  auditMenuId,
  useDeleteSeoAudit,
} from "./use-delete-seo-audit";

export function SeoAuditIndex({
  audits,
  nextCursor,
  cursor = null,
  projectId,
  addOpen = false,
}: {
  audits: SeoAuditSummary[];
  nextCursor: string | null;
  cursor?: string | null;
  /** The header's Project scope; a new Audit links to it. */
  projectId: string | null;
  /** The link asked for a new Audit, so its form starts open. */
  addOpen?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const deletion = useDeleteSeoAudit(audits, cursor, nextCursor, projectId);
  const hasAudits = deletion.rows.length > 0 || Boolean(nextCursor);
  const form = useCreateSeoAudit(projectId, addOpen && hasAudits);
  return (
    <div className="space-y-6">
      {hasAudits ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">{t("pickTitle")}</h2>
              <p className="text-muted-foreground text-sm">{t("pickBody")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {projectId ? (
                <Button variant="outline" asChild>
                  <Link href={seoProjectHref(projectId)}>
                    {t("audits.projectWorkspace")}
                  </Link>
                </Button>
              ) : null}
              <Button onClick={() => form.setOpen(true)}>
                <Plus className="size-4" />
                {t("audits.create")}
              </Button>
            </div>
          </div>
          <SeoSection
            title={t("audits.saved")}
            foot={
              nextCursor ? (
                <Button variant="outline" asChild>
                  <Link
                    id={AUDIT_LIST_MORE_ID}
                    href={seoIndexHref(projectId, nextCursor)}
                  >
                    {t("more")}
                  </Link>
                </Button>
              ) : null
            }
          >
            <ul className="space-y-2" hidden={!deletion.rows.length}>
              {deletion.rows.map((audit) => (
                <li
                  key={audit.id}
                  className={cn(HOLDER_ITEM_CLASS, "flex items-center gap-1")}
                >
                  <Link
                    id={auditLinkId(audit.id)}
                    href={seoAuditHref(audit.id, audit.projectId)}
                    className={cn(
                      HOLDER_ITEM_HOVER_CLASS,
                      "press flex min-w-0 flex-1 items-center gap-3 rounded-lg p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    )}
                  >
                    <SearchCheck className="size-5 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <h3 className="font-medium break-words">{audit.name}</h3>
                      <p className="text-muted-foreground text-sm">
                        {t("pages.count", { count: audit.pageCount })}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t("audits.created")}{" "}
                        <SeoDate value={audit.createdAt} />
                      </p>
                    </div>
                    <ArrowUpRight className="size-4 shrink-0" aria-hidden />
                  </Link>
                  {audit.canDelete === true ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          id={auditMenuId(audit.id)}
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="me-2 size-11 shrink-0"
                          aria-label={t("audits.moreOptions", {
                            name: audit.name,
                          })}
                        >
                          <Ellipsis aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        onCloseAutoFocus={(event) => {
                          if (deletion.selected?.id === audit.id)
                            event.preventDefault();
                        }}
                      >
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => deletion.open(audit)}
                        >
                          <Trash2 aria-hidden />
                          {t("audits.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              ))}
            </ul>
          </SeoSection>
        </>
      ) : cursor ? (
        <Button asChild variant="outline">
          <Link id={AUDIT_LIST_RETURN_ID} href={seoIndexHref(projectId)}>
            {t("audits.all")}
          </Link>
        </Button>
      ) : (
        <SeoAuditOnboarding form={form} projectId={projectId} />
      )}
      <AlertDialog
        open={Boolean(deletion.selected)}
        onOpenChange={(open) => {
          if (!open) deletion.close();
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            deletion.restoreFocus();
          }}
        >
          <AlertDialogHeader className="min-w-0">
            <AlertDialogTitle className="min-w-0 [overflow-wrap:anywhere]">
              {t("audits.deleteTitle", { name: deletion.selected?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("audits.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletion.error ? (
            <p role="alert" className="text-destructive text-sm">
              {t(`audits.${deletion.error}`)}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletion.pending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-semantic-destructive-solid text-semantic-destructive-foreground hover:bg-destructive-hover"
              disabled={deletion.error === "deleteUnavailable"}
              loading={deletion.pending}
              onClick={(event) => {
                event.preventDefault();
                void deletion.confirm();
              }}
            >
              {t("audits.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={form.open}
        onOpenChange={(open) => {
          if (!form.pending) form.setOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("audits.create")}</DialogTitle>
            <DialogDescription>{t("audits.createHelp")}</DialogDescription>
          </DialogHeader>
          <SeoAuditForm form={form} showCancel />
        </DialogContent>
      </Dialog>
    </div>
  );
}
