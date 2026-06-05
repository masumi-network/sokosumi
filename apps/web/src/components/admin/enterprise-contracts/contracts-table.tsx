"use client";

import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";

import { ContractStatusBadge } from "@/components/admin/enterprise-contracts/contract-status-badge";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  EnterpriseContract,
  EnterpriseContractStatus,
} from "@/lib/clients/generated/core/types.gen";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

const STATUS_OPTIONS: Array<EnterpriseContractStatus | "all"> = [
  "all",
  "draft",
  "active",
  "completed",
  "canceled",
];

const columnHelper = createColumnHelper<EnterpriseContract>();

const dateTimeOptions = {
  dateStyle: "medium",
  timeStyle: "short",
} as const;

function getColumns(
  t: ReturnType<typeof useTranslations<"App.Admin.EnterpriseContracts">>,
  formatter: ReturnType<typeof useFormatter>,
): ColumnDef<EnterpriseContract>[] {
  return [
    columnHelper.accessor("organizationSlug", {
      id: "organizationSlug",
      size: 180,
      minSize: 140,
      header: () => (
        <span className="text-sm font-medium">{t("Table.organization")}</span>
      ),
      cell: ({ row }) => (
        <Link
          href={`/organizations/${row.original.organizationSlug}`}
          className="font-medium hover:underline"
        >
          {row.original.organizationSlug}
        </Link>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<EnterpriseContract>,

    columnHelper.accessor("status", {
      id: "status",
      size: 110,
      minSize: 100,
      header: () => (
        <span className="text-sm font-medium">{t("Table.status")}</span>
      ),
      cell: ({ row }) => <ContractStatusBadge status={row.original.status} />,
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<EnterpriseContract>,

    columnHelper.accessor("seats", {
      id: "seats",
      size: 72,
      minSize: 64,
      header: () => (
        <span className="text-sm font-medium">{t("Table.seats")}</span>
      ),
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.seats}</span>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<EnterpriseContract>,

    columnHelper.accessor("creditsPerMonth", {
      id: "creditsPerMonth",
      size: 130,
      minSize: 120,
      header: () => (
        <span className="text-sm font-medium">
          {t("Table.creditsPerMonth")}
        </span>
      ),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatter.number(
            formatCreditsForDisplay(row.original.creditsPerMonth),
          )}
        </span>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<EnterpriseContract>,

    columnHelper.accessor("periods", {
      id: "periods",
      size: 88,
      minSize: 80,
      header: () => (
        <span className="text-sm font-medium">{t("Table.periods")}</span>
      ),
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.periods}</span>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<EnterpriseContract>,

    columnHelper.accessor("endsAt", {
      id: "endsAt",
      size: 160,
      minSize: 140,
      header: () => (
        <span className="text-sm font-medium">{t("Table.ends")}</span>
      ),
      cell: ({ row }) =>
        row.original.endsAt
          ? formatter.dateTime(row.original.endsAt, dateTimeOptions)
          : "—",
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<EnterpriseContract>,

    columnHelper.display({
      id: "actions",
      size: 88,
      minSize: 88,
      maxSize: 88,
      header: () => <span className="sr-only">{t("Table.actions")}</span>,
      cell: ({ row }) => (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/enterprise-contracts/${row.original.id}`}>
            {t("Table.view")}
          </Link>
        </Button>
      ),
    }) as ColumnDef<EnterpriseContract>,
  ];
}

interface ContractsTableProps {
  contracts: EnterpriseContract[];
  initialOrganizationSlug?: string;
  initialStatus?: EnterpriseContractStatus | "all";
}

export function ContractsTable({
  contracts,
  initialOrganizationSlug = "",
  initialStatus = "all",
}: ContractsTableProps) {
  const t = useTranslations("App.Admin.EnterpriseContracts");
  const formatter = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [organizationSlug, setOrganizationSlug] = useState(
    initialOrganizationSlug,
  );
  const [status, setStatus] = useState<EnterpriseContractStatus | "all">(
    initialStatus,
  );
  const columns = useMemo(() => getColumns(t, formatter), [t, formatter]);

  function applyFilters() {
    const params = new URLSearchParams(searchParams.toString());
    const trimmedSlug = organizationSlug.trim();

    if (trimmedSlug) {
      params.set("organizationSlug", trimmedSlug);
    } else {
      params.delete("organizationSlug");
    }

    if (status === "all") {
      params.delete("status");
    } else {
      params.set("status", status);
    }

    startTransition(() => {
      const query = params.toString();
      router.push(
        query
          ? `/admin/enterprise-contracts?${query}`
          : "/admin/enterprise-contracts",
      );
    });
  }

  function getStatusLabel(option: EnterpriseContractStatus | "all"): string {
    if (option === "all") {
      return t("Filters.statusAll");
    }
    return t(`Status.${option}`);
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid gap-4 border-b p-4 sm:grid-cols-[1fr_180px_auto]">
        <div className="space-y-2">
          <Label htmlFor="filter-organizationSlug">
            {t("Filters.organizationSlug")}
          </Label>
          <Input
            id="filter-organizationSlug"
            value={organizationSlug}
            onChange={(event) => setOrganizationSlug(event.target.value)}
            placeholder={t("Filters.organizationSlugPlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="filter-status">{t("Filters.status")}</Label>
          <Select
            value={status}
            onValueChange={(value) =>
              setStatus(value as EnterpriseContractStatus | "all")
            }
          >
            <SelectTrigger id="filter-status">
              <SelectValue placeholder={t("Filters.statusAll")} />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {getStatusLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            onClick={applyFilters}
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {t("Filters.apply")}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={contracts}
        containerClassName="rounded-none border-0 space-y-0 pb-4"
        tableClassName="[&_th:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4"
        tableHeaderClassName="bg-muted/50"
        showPagination={contracts.length > 10}
        showRowsPerPage={false}
        enableRowSelection={false}
        initialPageSize={10}
      />
    </div>
  );
}
