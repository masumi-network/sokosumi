"use client";

import type { SeoAuditSummary } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Ellipsis,
  Plus,
  SearchCheck,
} from "lucide-react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
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
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { setSeoAuditArchivedAction } from "@/lib/actions/seo/set-audit-archived";
import { cn } from "@/lib/utils";
import { seoAuditHref, seoIndexHref, seoProjectHref } from "../seo-href";
import { SeoAuditForm } from "./seo-audit-form";
import { SeoAuditOnboarding } from "./seo-audit-onboarding";
import { SeoDate } from "./seo-shared";
import { useCreateSeoAudit } from "./use-create-seo-audit";

const SAVED_AUDITS_TITLE_ID = "seo-saved-audits";
const AUDIT_ROW_CLASS = "flex min-w-0 items-center gap-3 p-4";

export function SeoAuditIndex({
  audits,
  nextCursor,
  cursor = null,
  projectId,
  addOpen = false,
  archived = false,
  searching = false,
}: {
  audits: SeoAuditSummary[];
  nextCursor: string | null;
  cursor?: string | null;
  /** The header's Project scope; a new Audit links to it. */
  projectId: string | null;
  /** The link asked for a new Audit, so its form starts open. */
  addOpen?: boolean;
  archived?: boolean;
  searching?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const tSearch = useTranslations("App.PageSearch");
  const hasAudits = audits.length > 0 || Boolean(nextCursor);
  const form = useCreateSeoAudit(projectId, !archived && addOpen && hasAudits);
  const [pending, startRestore] = useTransition();
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<
    "restoreFailed" | "restoreTaskScopeConflict" | null
  >(null);

  function handleRestore(audit: SeoAuditSummary) {
    setRestoreId(audit.id);
    setRestoreError(null);
    startRestore(async () => {
      try {
        const result = await setSeoAuditArchivedAction({
          auditId: audit.id,
          projectId: audit.projectId,
          archived: false,
        });
        if (!result.ok) {
          setRestoreError(
            result.error.kind ===
              CORE_API_ERROR_KINDS.SEO_AUDIT_TASK_SCOPE_CONFLICT
              ? "restoreTaskScopeConflict"
              : "restoreFailed",
          );
        }
      } catch (error) {
        unstable_rethrow(error);
        setRestoreError("restoreFailed");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={SAVED_AUDITS_TITLE_ID} className="text-xl font-semibold">
          {t(archived ? "audits.archived" : "audits.saved")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {!archived && hasAudits ? (
            <>
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
            </>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label={t("audits.listOptions")}
              >
                <Ellipsis aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={seoIndexHref(projectId, { archived: !archived })}>
                  {archived ? (
                    <SearchCheck aria-hidden />
                  ) : (
                    <Archive aria-hidden />
                  )}
                  {t(archived ? "audits.showActive" : "audits.showArchived")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {hasAudits ? (
        <section
          aria-labelledby={SAVED_AUDITS_TITLE_ID}
          className={cn(HOLDER_CLASS, "min-w-0 space-y-2")}
        >
          <ul className="space-y-2" hidden={!audits.length}>
            {audits.map((audit) => {
              const description = (
                <>
                  <SearchCheck className="size-5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-2">
                    <h3 className="font-medium break-words">{audit.name}</h3>
                    <p className="text-muted-foreground text-sm">
                      {t("pages.count", { count: audit.pageCount })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("audits.created")} <SeoDate value={audit.createdAt} />
                    </p>
                  </div>
                </>
              );
              return (
                <li key={audit.id}>
                  {archived ? (
                    <div className={cn(HOLDER_ITEM_CLASS, "space-y-2")}>
                      <div className={AUDIT_ROW_CLASS}>
                        {description}
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t("audits.restoreLabel", {
                            name: audit.name,
                          })}
                          disabled={pending && restoreId !== audit.id}
                          loading={pending && restoreId === audit.id}
                          onClick={() => handleRestore(audit)}
                        >
                          <ArchiveRestore aria-hidden />
                          {t("audits.restore")}
                        </Button>
                      </div>
                      {restoreId === audit.id && restoreError ? (
                        <p
                          role="alert"
                          className="text-destructive px-4 pb-4 text-sm"
                        >
                          {t(`audits.${restoreError}`)}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <Link
                      href={seoAuditHref(audit.id, audit.projectId)}
                      className={cn(
                        HOLDER_ITEM_CLASS,
                        HOLDER_ITEM_HOVER_CLASS,
                        AUDIT_ROW_CLASS,
                        "press focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      )}
                    >
                      {description}
                      <ArrowUpRight className="size-4 shrink-0" aria-hidden />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {nextCursor ? (
            <div className="px-2">
              <Button variant="outline" asChild>
                <Link
                  href={seoIndexHref(projectId, {
                    archived,
                    cursor: nextCursor,
                  })}
                >
                  {t("more")}
                </Link>
              </Button>
            </div>
          ) : null}
        </section>
      ) : searching ? (
        <p role="status" className="text-muted-foreground text-sm">
          {tSearch("noMatches")}
        </p>
      ) : cursor ? (
        <Button asChild variant="outline">
          <Link href={seoIndexHref(projectId, { archived })}>
            {t(archived ? "audits.archived" : "audits.all")}
          </Link>
        </Button>
      ) : archived ? (
        <p className="text-muted-foreground text-sm">
          {t("audits.archivedEmpty")}
        </p>
      ) : (
        <SeoAuditOnboarding form={form} projectId={projectId} />
      )}
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
