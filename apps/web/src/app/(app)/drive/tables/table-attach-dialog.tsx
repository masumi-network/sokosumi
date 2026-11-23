"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, Search, Table2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type RefObject, useState } from "react";
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
import { useAbortController } from "@/hooks/effects/use-abort-controller";
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
  const { data: session } = useSession();
  // No list until the session says which workspace is active, so a cached
  // list from another workspace never shows under a fallback key.
  const workspaceId = session
    ? (session.session.activeOrganizationId ?? "personal")
    : null;
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aborted on dismissal, unmount or a workspace switch, so a copy still
  // being made is dropped, never attached.
  const copying = useAbortController(workspaceId);
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
    enabled: workspaceId !== null,
  });
  const items = tables.data?.pages.flatMap((page) => page.items) ?? [];
  // Only a Table the reader can see now may be copied.
  const selected = items.find((table) => table.id === selectedId);

  function dismiss() {
    copying.abort();
    onClose();
  }

  async function add() {
    if (!selected) return;
    const controller = copying.start();
    setPending(true);
    setError(null);
    try {
      const file = await tableCsvFile(selected.id, new Date());
      if (controller.signal.aborted) return;
      if (!file) {
        setError(t("tooLarge"));
        return;
      }
      onPick(file);
      onClose();
    } catch {
      if (!controller.signal.aborted) setError(t("error"));
    } finally {
      copying.release(controller);
      setPending(false);
    }
  }
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
            className="pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <div className="-mx-1 max-h-80 overflow-y-auto overscroll-contain px-1">
          {tables.isPending ? (
            <TableSkeleton />
          ) : tables.isError && !tables.data ? (
            <p
              role="alert"
              className="text-destructive py-8 text-center text-sm"
            >
              {t("loadError")}
            </p>
          ) : items.length === 0 ? (
            <NoTables searched={Boolean(debouncedSearch)} />
          ) : (
            <fieldset className="space-y-1">
              <legend className="sr-only">{t("title")}</legend>
              {items.map((table) => (
                <TableOption
                  key={table.id}
                  table={table}
                  checked={selectedId === table.id}
                  disabled={pending}
                  onSelect={() => setSelectedId(table.id)}
                />
              ))}
              {tables.isFetchNextPageError && (
                <p role="alert" className="text-destructive px-3 text-sm">
                  {t("loadMoreError")}
                </p>
              )}
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
            disabled={!selected}
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

function TableSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 p-3">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-4 w-40" />
        </div>
      ))}
    </div>
  );
}

function NoTables({ searched }: { searched: boolean }) {
  const t = useTranslations("App.Tables.attach");
  return (
    <div className="py-8 text-center text-sm">
      <p className="text-muted-foreground">
        {t(searched ? "noMatches" : "empty")}
      </p>
      {!searched && (
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
  );
}

function TableOption({
  table,
  checked,
  disabled,
  onSelect,
}: {
  table: { id: string; title: string; updatedAt: Date | string };
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const format = useFormatter();
  return (
    <label className="hover:bg-accent has-[:checked]:bg-accent has-[:focus-visible]:ring-ring flex cursor-pointer items-center gap-3 rounded-md p-3 text-sm transition-colors has-[:focus-visible]:ring-2">
      <input
        type="radio"
        name="table"
        value={table.id}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
      />
      <Table2 aria-hidden className="text-muted-foreground size-5 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{table.title}</span>
        <span className="text-muted-foreground text-xs">
          {format.dateTime(new Date(table.updatedAt), { dateStyle: "medium" })}
        </span>
      </span>
      {checked && <Check aria-hidden className="size-4 shrink-0" />}
    </label>
  );
}
