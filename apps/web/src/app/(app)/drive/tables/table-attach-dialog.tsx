"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, Table2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type RefObject, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/auth.client";
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
import { tableCsvFile } from "./table-csv";

/** Core's longest Table search. */
const SEARCH_MAX_LENGTH = 200;

interface TableAttachDialogProps {
  onClose: () => void;
  /** Gets a CSV snapshot of the picked Table, to attach like any file. */
  onPick: (file: File) => void;
  /** Where keyboard focus goes back to once the picker closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Picks a Files Table and, once the reader confirms, turns it into a dated
 * CSV snapshot. Mount it to open it.
 */
export function TableAttachDialog({
  onClose,
  onPick,
  returnFocusRef,
}: TableAttachDialogProps) {
  const t = useTranslations("App.Tables.attach");
  const format = useFormatter();
  const { data: session } = useSession();
  const workspaceId = session?.session.activeOrganizationId ?? "personal";
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on dismissal, so a copy still being made is dropped, not attached.
  const attempt = useRef(0);
  const tables = useInfiniteQuery({
    queryKey: ["data-tables", workspaceId, "attach", debouncedSearch],
    queryFn: ({ pageParam }) =>
      dataTableService.list({
        archived: "false",
        cursor: pageParam,
        search: debouncedSearch || undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  function dismiss() {
    attempt.current++;
    onClose();
  }

  async function add() {
    if (!selectedId) return;
    const current = ++attempt.current;
    setPending(true);
    setError(null);
    try {
      const file = await tableCsvFile(selectedId, new Date());
      if (current !== attempt.current) return;
      if (!file) {
        setError(t("tooLarge"));
        return;
      }
      onPick(file);
      onClose();
    } catch {
      if (current === attempt.current) setError(t("error"));
    } finally {
      setPending(false);
    }
  }

  const items = tables.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
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
            maxLength={SEARCH_MAX_LENGTH}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8"
          />
        </div>
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
            <fieldset className="space-y-1">
              <legend className="sr-only">{t("title")}</legend>
              {items.map((table) => (
                <label
                  key={table.id}
                  className="hover:bg-accent has-[:checked]:bg-accent has-[:focus-visible]:ring-ring flex cursor-pointer items-center gap-3 rounded-md p-3 text-sm transition-colors has-[:focus-visible]:ring-2"
                >
                  <input
                    type="radio"
                    name="table"
                    value={table.id}
                    checked={selectedId === table.id}
                    disabled={pending}
                    onChange={() => setSelectedId(table.id)}
                    className="sr-only"
                  />
                  <Table2
                    aria-hidden
                    className="text-muted-foreground size-5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{table.title}</span>
                    <span className="text-muted-foreground text-xs">
                      {format.dateTime(new Date(table.updatedAt), {
                        dateStyle: "medium",
                      })}
                    </span>
                  </span>
                </label>
              ))}
              {tables.hasNextPage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  loading={tables.isFetchingNextPage}
                  onClick={() => void tables.fetchNextPage()}
                >
                  {t("loadMore")}
                </Button>
              )}
            </fieldset>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <p className="text-muted-foreground text-xs">{t("publicCopy")}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={dismiss}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={!selectedId}
            loading={pending}
            onClick={() => void add()}
          >
            {t("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
