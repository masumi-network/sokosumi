"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Pin, Table2, Users } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
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
import { contactsService } from "@/lib/services/contacts.client";
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
    // Always revalidate on mount and focus, so a table changed elsewhere moves
    // up; the cached page stays on screen meanwhile instead of a loader.
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const contacts = useQuery({
    queryKey: ["contacts-count", workspaceId],
    queryFn: () => contactsService.list({ limit: 1 }),
    enabled: !archived,
    staleTime: 0,
  });
  if (query.isPending) return <DriveListSkeleton viewMode="list" />;
  return (
    // Literally the surface Recents and browse render into, from their own
    // helper, so switching tabs no longer switches page languages. The tab
    // already names the view, so the heading is for assistive technology.
    <section className={cn(driveItemsPanelClass("list"), "space-y-2")}>
      <h2 className="sr-only">{t("tables")}</h2>
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
        {!archived && (
          <Link
            href="/contacts"
            className={cn(
              driveItemArticleClass("list"),
              "focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:ring-offset-2",
            )}
          >
            <div className={driveItemBodyClass("list")}>
              <div
                className={cn(
                  driveItemIconWellClass("list"),
                  "bg-primary-quinary rounded-lg",
                )}
              >
                <Users aria-hidden className="text-primary size-5" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <h3 className={driveItemNameClass()}>{t("contactsName")}</h3>
                  <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
                    <Pin aria-hidden className="size-3" />
                    {t("contactsPinned")}
                  </span>
                </span>
                {contacts.data && (
                  <div className={driveItemMetaMobileClass("list")}>
                    <span>
                      {t("contactsCount", { count: contacts.data.total })}
                    </span>
                  </div>
                )}
              </div>
              {contacts.data && (
                <div className={driveItemMetaDesktopClass("list")}>
                  <span>
                    {t("contactsCount", { count: contacts.data.total })}
                  </span>
                </div>
              )}
            </div>
          </Link>
        )}
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
                  <span>{t("columnCount", { count: table.columnCount })}</span>
                  <span>
                    {format.dateTime(new Date(table.updatedAt), {
                      dateStyle: "medium",
                    })}
                  </span>
                </div>
              </div>
              <div className={driveItemMetaDesktopClass("list")}>
                <span>{t("columnCount", { count: table.columnCount })}</span>
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
