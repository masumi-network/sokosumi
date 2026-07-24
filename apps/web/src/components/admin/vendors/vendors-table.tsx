"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { getVendorsTableColumns } from "@/components/admin/vendors/vendors-table-columns";
import { DataTable } from "@/components/data-table";
import { Input } from "@/components/ui/input";
import type { Vendor } from "@/lib/clients/generated/core";

interface VendorsTableProps {
  vendors: Vendor[];
}

function matchesSearch(vendor: Vendor, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return [vendor.name, vendor.slug].join(" ").toLowerCase().includes(needle);
}

export function VendorsTable({ vendors }: VendorsTableProps) {
  const t = useTranslations("App.Admin.Vendors.Table");
  const formatter = useFormatter();
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => vendors.filter((vendor) => matchesSearch(vendor, search)),
    [search, vendors],
  );

  const columns = useMemo(
    () => getVendorsTableColumns(t, formatter),
    [formatter, t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full min-w-[16rem] sm:max-w-sm"
          aria-label={t("searchPlaceholder")}
        />
        <p className="text-muted-foreground text-sm tabular-nums sm:pb-2">
          {search.trim()
            ? t("filteredCount", {
                shown: filtered.length,
                total: vendors.length,
              })
            : t("totalCount", { count: vendors.length })}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {vendors.length === 0
            ? t("empty")
            : search.trim()
              ? t("emptySearch")
              : t("empty")}
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
