"use client";
import { useQuery } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  driveItemArticleClass,
  driveItemBodyClass,
  driveItemIconWellClass,
  driveItemMetaDesktopClass,
  driveItemMetaMobileClass,
  driveItemNameClass,
  driveItemsListClass,
  driveItemsPanelClass,
} from "@/app/drive/components/drive-view-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
import { tableError } from "./table-value";

export function TableList({
  workspaceId,
  archived,
}: {
  workspaceId: string | null;
  archived: boolean;
}) {
  const t = useTranslations("App.Tables");
  const format = useFormatter();
  const [cursor, setCursor] = useState<string>();
  const previousArchivedRef = useRef(archived);
  if (previousArchivedRef.current !== archived) {
    previousArchivedRef.current = archived;
    setCursor(undefined);
  }
  const query = useQuery({
    queryKey: ["data-tables", workspaceId, archived, cursor],
    queryFn: () =>
      dataTableService.list({ archived: archived ? "true" : "false", cursor }),
    refetchInterval: 5000,
  });
  return (
    // Literally the surface Recents and browse render into, from their own
    // helper, so switching tabs no longer switches page languages. The tab
    // already names the view, so the heading is for assistive technology.
    <section className={cn(driveItemsPanelClass("list"), "space-y-2")}>
      <h2 className="sr-only">{t("tables")}</h2>
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
      {/* A table is a Files item, so it wears the Files item row: the same
      helpers the drive cards use, not a lookalike. */}
      <div className={driveItemsListClass("list")}>
        {query.data?.items.map((table) => (
          <Link
            href={`/drive/tables/${table.id}`}
            key={table.id}
            className={cn(
              driveItemArticleClass("list"),
              "focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:ring-offset-2",
            )}
          >
            <div className={driveItemBodyClass("list")}>
              <div className={driveItemIconWellClass("list")}>
                <Table2 aria-hidden className="text-muted-foreground size-5" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h3 className={driveItemNameClass()}>{table.title}</h3>
                <div className={driveItemMetaMobileClass("list")}>
                  <span>
                    {t("columnCount", { count: table.columns.length })}
                  </span>
                  <span>
                    {format.dateTime(new Date(table.updatedAt), {
                      dateStyle: "medium",
                    })}
                  </span>
                </div>
              </div>
              <div className={driveItemMetaDesktopClass("list")}>
                <span>{t("columnCount", { count: table.columns.length })}</span>
                <span>
                  {format.dateTime(new Date(table.updatedAt), {
                    dateStyle: "medium",
                  })}
                </span>
              </div>
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
