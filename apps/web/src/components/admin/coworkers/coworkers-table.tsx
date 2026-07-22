"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { getCoworkersTableColumns } from "@/components/admin/coworkers/coworkers-table-columns";
import { DataTable } from "@/components/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";

interface CoworkersTableProps {
  coworkers: Coworker[];
}

type ArchiveFilter = "all" | "active" | "archived";

function isArchived(coworker: Coworker): boolean {
  return coworker.archivedAt != null;
}

function matchesArchiveFilter(
  coworker: Coworker,
  archiveFilter: ArchiveFilter,
): boolean {
  if (archiveFilter === "all") {
    return true;
  }

  if (archiveFilter === "archived") {
    return isArchived(coworker);
  }

  return !isArchived(coworker);
}

function matchesSearch(coworker: Coworker, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const haystack = [
    coworker.name,
    coworker.slug,
    coworker.caption ?? "",
    coworker.vendor.name,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

export function CoworkersTable({ coworkers }: CoworkersTableProps) {
  const t = useTranslations("App.Admin.Coworkers.Table");
  const formatter = useFormatter();
  const [search, setSearch] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");

  const filtered = useMemo(
    () =>
      coworkers.filter(
        (coworker) =>
          matchesArchiveFilter(coworker, archiveFilter) &&
          matchesSearch(coworker, search),
      ),
    [archiveFilter, coworkers, search],
  );

  const columns = useMemo(
    () => getCoworkersTableColumns(t, formatter),
    [formatter, t],
  );

  const archiveFilterLabel =
    archiveFilter === "all"
      ? t("filterAll")
      : archiveFilter === "active"
        ? t("filterActive")
        : t("filterArchived");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full min-w-[16rem] sm:max-w-sm"
            aria-label={t("searchPlaceholder")}
          />
          <div className="space-y-2">
            <Label id="coworker-archive-filter-label">
              {t("archiveFilterLabel")}
            </Label>
            <Tabs
              value={archiveFilter}
              onValueChange={(value) => {
                setArchiveFilter(value as ArchiveFilter);
              }}
            >
              <TabsList aria-labelledby="coworker-archive-filter-label">
                <TabsTrigger value="all">{t("filterAll")}</TabsTrigger>
                <TabsTrigger value="active">{t("filterActive")}</TabsTrigger>
                <TabsTrigger value="archived">
                  {t("filterArchived")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums sm:pb-2">
          {search.trim() || archiveFilter !== "all"
            ? t("filteredCount", {
                shown: filtered.length,
                total: coworkers.length,
              })
            : t("totalCount", { count: coworkers.length })}
          {archiveFilter !== "all" ? (
            <span className="sr-only">{archiveFilterLabel}</span>
          ) : null}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {coworkers.length === 0
            ? t("empty")
            : search.trim()
              ? t("emptySearch")
              : t("emptyFilter")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <DataTable
            columns={columns}
            data={filtered}
            containerClassName="space-y-0"
            tableHeaderClassName="bg-muted/50"
            showPagination={false}
            enableRowSelection={false}
            disableHover
            defaultSort={[{ id: "createdAt", desc: true }]}
          />
        </div>
      )}
    </div>
  );
}
