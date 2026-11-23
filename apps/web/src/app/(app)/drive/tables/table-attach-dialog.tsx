"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Table2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
import { tableCsvFile } from "./table-csv";

interface TableAttachDialogProps {
  onClose: () => void;
  /** Gets a CSV snapshot of the picked Table, to attach like any file. */
  onPick: (file: File) => void;
}

/** Picks a Files Table and turns it into a dated CSV snapshot. Mount it to open it. */
export function TableAttachDialog({ onClose, onPick }: TableAttachDialogProps) {
  const t = useTranslations("App.Tables.attach");
  const format = useFormatter();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tables = useQuery({
    queryKey: ["data-tables", "attach", debouncedSearch],
    queryFn: () =>
      dataTableService.list({
        archived: "false",
        search: debouncedSearch || undefined,
      }),
  });

  async function pick(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const file = await tableCsvFile(id, new Date());
      if (!file) {
        setError(t("tooLarge"));
        return;
      }
      onPick(file);
      onClose();
    } catch {
      setError(t("error"));
    } finally {
      setPendingId(null);
    }
  }

  const items = tables.data?.items ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            aria-hidden
            className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            aria-label={t("search")}
            placeholder={t("search")}
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8"
          />
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="-mx-1 max-h-80 overflow-y-auto overscroll-contain px-1">
          {tables.isPending ? (
            <div className="space-y-1">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="flex items-center gap-3 p-3">
                  <Skeleton className="size-5 rounded" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          ) : tables.isError ? (
            <p
              role="alert"
              className="text-destructive py-8 text-center text-sm"
            >
              {t("loadError")}
            </p>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm">
              <p className="text-muted-foreground">
                {t(debouncedSearch ? "noMatches" : "empty")}
              </p>
              {!debouncedSearch && (
                <Link
                  href="/drive?view=tables"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "mt-3",
                  )}
                >
                  {t("openTables")}
                </Link>
              )}
            </div>
          ) : (
            <ul className="space-y-1">
              {items.map((table) => (
                <li key={table.id}>
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    aria-busy={pendingId === table.id}
                    onClick={() => void pick(table.id)}
                    className={cn(
                      buttonVariants({ variant: "ghost" }),
                      "h-auto w-full justify-start gap-3 whitespace-normal p-3 text-left",
                    )}
                  >
                    {pendingId === table.id ? (
                      <Loader2
                        aria-hidden
                        className="text-muted-foreground size-5 shrink-0 animate-spin motion-reduce:animate-pulse"
                      />
                    ) : (
                      <Table2
                        aria-hidden
                        className="text-muted-foreground size-5 shrink-0"
                      />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">
                        {table.title}
                      </span>
                      <span className="text-muted-foreground text-xs font-normal">
                        {format.dateTime(new Date(table.updatedAt), {
                          dateStyle: "medium",
                        })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
