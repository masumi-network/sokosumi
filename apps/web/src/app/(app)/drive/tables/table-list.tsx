"use client";
import { useQuery } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { dataTableService } from "@/lib/services/data-table.client";
import { tableError } from "./table-value";

export function TableList({ workspaceId }: { workspaceId: string | null }) {
  const t = useTranslations("App.Tables");
  const format = useFormatter();
  const [archived, setArchived] = useState(false);
  const [cursor, setCursor] = useState<string>();
  const query = useQuery({
    queryKey: ["data-tables", workspaceId, archived, cursor],
    queryFn: () =>
      dataTableService.list({ archived: archived ? "true" : "false", cursor }),
    refetchInterval: 5000,
  });
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t("tables")}</h2>
        <Button
          variant="ghost"
          onClick={() => {
            setArchived(!archived);
            setCursor(undefined);
          }}
        >
          {archived ? t("showActive") : t("showArchived")}
        </Button>
      </div>
      {query.isPending && (
        <p role="status" className="text-muted-foreground">
          {t("loading")}
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-destructive">
          {tableError(query.error, t)}{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </p>
      )}
      {query.data?.items.length === 0 && (
        <div className="rounded-xl border p-8 text-center">
          <Table2
            aria-hidden
            className="text-muted-foreground mx-auto mb-3 size-8"
          />
          <h3 className="font-medium">{t("empty")}</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            {t("emptyDescription")}
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {query.data?.items.map((table) => (
          <Link
            href={`/drive/tables/${table.id}`}
            key={table.id}
            className="bg-card hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-xl border p-4 focus-visible:ring-2"
          >
            <div className="bg-muted rounded-lg p-3">
              <Table2 aria-hidden className="text-muted-foreground size-5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium">{table.title}</h3>
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {format.dateTime(new Date(table.updatedAt), {
                  dateStyle: "medium",
                })}{" "}
                · {t("columnCount", { count: table.columns.length })}
              </p>
            </div>
          </Link>
        ))}
      </div>
      <div className="flex gap-2">
        {cursor && (
          <Button variant="outline" onClick={() => setCursor(undefined)}>
            {t("firstPage")}
          </Button>
        )}
        {query.data?.nextCursor && (
          <Button
            variant="outline"
            onClick={() => setCursor(query.data?.nextCursor ?? undefined)}
          >
            {t("nextPage")}
          </Button>
        )}
      </div>
    </section>
  );
}
