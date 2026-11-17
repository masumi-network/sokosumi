"use client";

import { Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
import { type SeoExport, seoTablePlan } from "./seo-export-model";

type Attempt = {
  plan: ReturnType<typeof seoTablePlan>;
  tableId?: string;
  done: number;
};

/**
 * Copies one exported table into a new Files Table, a snapshot that SEO does not update. A failed copy
 * finishes on the next press: the same Table and the batches not yet saved, under the same keys.
 */
export function SeoTableButton({
  title,
  site,
  projectId,
  table,
  className,
}: {
  title: string;
  /** The audited site, in the Table's name. */
  site: string;
  projectId: string | null;
  table: () => SeoExport;
  className?: string;
}) {
  const t = useTranslations("App.Seo.export");
  const format = useFormatter();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const attempt = useRef<Attempt | null>(null);

  async function copy() {
    setPending(true);
    if (!attempt.current) {
      const now = new Date();
      attempt.current = {
        done: 0,
        plan: seoTablePlan(
          table(),
          {
            title: t("tableTitle", {
              table: title,
              site,
              date: format.dateTime(now, { dateStyle: "medium" }),
            }),
            description: t("tableDescription", {
              date: format.dateTime(now, "dateTimeMedium"),
            }),
            projectId,
          },
          crypto.randomUUID(),
        ),
      };
    }
    const current = attempt.current;
    const { plan } = current;
    try {
      current.tableId ??= (await dataTableService.create(plan.table)).id;
      // One batch at a time, in order: a retry resumes at the first batch not saved.
      for (; current.done < plan.batches.length; current.done++)
        await dataTableService.batch(
          current.tableId,
          plan.batches[current.done],
        );
      attempt.current = null;
      const id = current.tableId;
      toast.success(
        t("tableCopied", {
          count: plan.batches.reduce((sum, b) => sum + b.insert.length, 0),
        }),
        {
          action: {
            label: t("openTable"),
            onClick: () => router.push(`/drive/tables/${id}`),
          },
        },
      );
    } catch {
      toast.error(t("tableFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("text-muted-foreground", className)}
      aria-label={t("tableLabel", { table: title })}
      loading={pending}
      onClick={copy}
    >
      <Table2 className="size-4" />
      {t("table")}
    </Button>
  );
}
