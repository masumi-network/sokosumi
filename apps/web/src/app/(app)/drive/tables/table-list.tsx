"use client";
import { useQuery } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { driveItemsPanelClass } from "@/app/drive/components/drive-view-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
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
    // Literally the surface Recents and browse render into, from their own
    // helper, so switching tabs no longer switches page languages.
    <section
      className={cn(driveItemsPanelClass("list"), "space-y-4 p-4 md:p-6")}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="sr-only">{t("tables")}</h2>
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto"
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
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">
              {tableError(query.error, t)}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {query.data?.items.length === 0 && (
        <div className="py-12 text-center">
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
            className="bg-card hover:bg-card-background-hover focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2"
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
      {(cursor || query.data?.nextCursor) && (
        <div className="flex justify-end gap-2">
          {cursor && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCursor(undefined)}
            >
              {t("firstPage")}
            </Button>
          )}
          {query.data?.nextCursor && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCursor(query.data?.nextCursor ?? undefined)}
            >
              {t("nextPage")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
