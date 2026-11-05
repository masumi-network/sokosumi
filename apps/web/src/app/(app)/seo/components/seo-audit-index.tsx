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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SeoField } from "./seo-form-fields";
import { SeoDate, SeoEmpty, SeoSection } from "./seo-shared";
import { useCreateSeoAudit } from "./use-create-seo-audit";

export function SeoAuditIndex({
  audits,
  nextCursor,
}: {
  audits: SeoAuditSummary[];
  nextCursor: string | null;
}) {
  const t = useTranslations("App.Seo");
  const form = useCreateSeoAudit();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t("pickTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("pickBody")}</p>
        </div>
        <Button onClick={() => form.setOpen(true)}>
          <Plus className="size-4" />
          {t("audits.create")}
        </Button>
      </div>
      {audits.length ? (
        <SeoSection title={t("audits.saved")}>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {audits.map((audit) => (
              <li key={audit.id}>
                <Link
                  href={`/seo?auditId=${encodeURIComponent(audit.id)}`}
                  className={cn(
                    HOLDER_ITEM_CLASS,
                    "hover:bg-quinary flex h-full items-start gap-3 p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  )}
                >
                  <SearchCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-2">
                    <h3 className="font-medium break-words">{audit.name}</h3>
                    <p className="text-muted-foreground text-sm">
                      {t("pages.count", { count: audit.pageCount })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("audits.updated")} <SeoDate value={audit.updatedAt} />
                    </p>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </SeoSection>
      ) : (
        <SeoEmpty title={t("audits.empty")} body={t("audits.emptyBody")} />
      )}
      {nextCursor ? (
        <Button variant="outline" asChild>
          <Link href={`/seo?cursor=${encodeURIComponent(nextCursor)}`}>
            {t("more")}
          </Link>
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
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.submit(new FormData(event.currentTarget));
            }}
          >
            <SeoField id="seo-audit-name" label={t("audits.name")}>
              <Input
                id="seo-audit-name"
                name="name"
                maxLength={100}
                required
                disabled={form.pending}
              />
            </SeoField>
            <SeoField id="seo-audit-url" label={t("audits.firstPage")}>
              <Input
                id="seo-audit-url"
                name="url"
                type="url"
                maxLength={4096}
                required
                disabled={form.pending}
              />
            </SeoField>
            {form.error ? (
              <p role="alert" className="text-destructive text-sm">
                {form.error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => form.setOpen(false)}
                disabled={form.pending}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                loading={form.pending}
                disabled={form.pending}
              >
                {t("audits.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
