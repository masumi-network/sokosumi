"use client";

import type { SeoAuditSummary } from "@sokosumi/core-client";
import { ArrowUpRight, Plus, SearchCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { seoAuditHref, seoIndexHref, seoProjectHref } from "../seo-href";
import { SeoAuditForm } from "./seo-audit-form";
import { SeoAuditOnboarding } from "./seo-audit-onboarding";
import { SeoDate, SeoSection } from "./seo-shared";
import { useCreateSeoAudit } from "./use-create-seo-audit";

export function SeoAuditIndex({
  audits,
  nextCursor,
  projectId,
}: {
  audits: SeoAuditSummary[];
  nextCursor: string | null;
  /** The header's Project scope; a new Audit links to it. */
  projectId: string | null;
}) {
  const t = useTranslations("App.Seo");
  const form = useCreateSeoAudit(projectId);
  return (
    <div className="space-y-6">
      {audits.length ? (
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
          <SeoSection title={t("audits.saved")}>
            <ul className="space-y-2">
              {audits.map((audit) => (
                <li key={audit.id}>
                  <Link
                    href={seoAuditHref(audit.id, audit.projectId)}
                    className={cn(
                      HOLDER_ITEM_CLASS,
                      "hover:bg-quinary flex items-center gap-3 p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    )}
                  >
                    <SearchCheck
                      className="mt-0.5 size-5 shrink-0"
                      aria-hidden
                    />
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
                </li>
              ))}
            </ul>
          </SeoSection>
        </>
      ) : (
        <SeoAuditOnboarding form={form} projectId={projectId} />
      )}
      {nextCursor ? (
        <Button variant="outline" asChild>
          <Link href={seoIndexHref(projectId, nextCursor)}>{t("more")}</Link>
        </Button>
      ) : null}
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
