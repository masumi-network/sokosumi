"use client";

import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { ContractStatusBadge } from "@/components/admin/enterprise-contracts/contract-status-badge";
import { DataTable, type DataTableFeatures } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { searchOrganizationsClient } from "@/lib/actions/admin-search/client";
import type {
  EnterpriseContract,
  EnterpriseContractStatus,
} from "@/lib/clients/generated/core/types.gen";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

const ENTERPRISE_CONTRACT_STATUSES = [
  "draft",
  "active",
  "completed",
  "canceled",
] as const satisfies readonly EnterpriseContractStatus[];

const STATUS_OPTIONS: Array<EnterpriseContractStatus | "all"> = [
  "all",
  ...ENTERPRISE_CONTRACT_STATUSES,
];

const enterpriseContractFilterParsers = {
  organizationSlug: parseAsString.withDefault(""),
  status: parseAsStringLiteral(ENTERPRISE_CONTRACT_STATUSES),
};

const columnHelper = createColumnHelper<
  DataTableFeatures,
  EnterpriseContract
>();

const dateTimeOptions = {
  dateStyle: "medium",
  timeStyle: "short",
} as const;

function getColumns(
  t: ReturnType<typeof useTranslations<"App.Admin.EnterpriseContracts">>,
  formatter: ReturnType<typeof useFormatter>,
): ColumnDef<DataTableFeatures, EnterpriseContract>[] {
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
    }) as ColumnDef<DataTableFeatures, EnterpriseContract>,

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
    }) as ColumnDef<DataTableFeatures, EnterpriseContract>,

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
    }) as ColumnDef<DataTableFeatures, EnterpriseContract>,

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
    }) as ColumnDef<DataTableFeatures, EnterpriseContract>,

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
    }) as ColumnDef<DataTableFeatures, EnterpriseContract>,

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
    }) as ColumnDef<DataTableFeatures, EnterpriseContract>,

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
    }) as ColumnDef<DataTableFeatures, EnterpriseContract>,
  ];
}

interface ContractsTableProps {
  contracts: EnterpriseContract[];
  /** Seeds the filter combobox with the organization from the active URL slug. */
  initialFilterOrganization: AdminOrganizationOption | null;
}

export function ContractsTable({
  contracts,
  initialFilterOrganization,
}: ContractsTableProps) {
  const t = useTranslations("App.Admin.EnterpriseContracts");
  const tOrg = useTranslations("Components.OrganizationCombobox");
  const formatter = useFormatter();
  const [isPending, startTransition] = useTransition();
  const [appliedFilters, setAppliedFilters] = useQueryStates(
    enterpriseContractFilterParsers,
  );
  const [organizationSlug, setOrganizationSlug] = useState(
    appliedFilters.organizationSlug,
  );
  const [selectedFilterOrganization, setSelectedFilterOrganization] =
    useState<AdminOrganizationOption | null>(initialFilterOrganization);
  const [status, setStatus] = useState<EnterpriseContractStatus | "all">(
    appliedFilters.status ?? "all",
  );

  useEffect(() => {
    setOrganizationSlug(appliedFilters.organizationSlug);
    setStatus(appliedFilters.status ?? "all");
  }, [appliedFilters.organizationSlug, appliedFilters.status]);

  // Keep the combobox selection in sync with the server-resolved organization
  // for the active URL slug. The server component re-runs on navigation (filter
  // apply, browser back/forward) and provides the matching option, so the
  // trigger never shows a stale org or an empty placeholder while a slug filter
  // is active. Local (unapplied) selections are preserved because this prop
  // only changes on a server render.
  useEffect(() => {
    setSelectedFilterOrganization(initialFilterOrganization);
  }, [initialFilterOrganization]);

  const orgLabels = buildComboboxLabels(tOrg, {
    placeholder: t("Filters.organizationAll"),
    clear: t("Filters.organizationAll"),
  });

  const columns = useMemo(() => getColumns(t, formatter), [t, formatter]);

  function applyFilters() {
    startTransition(() => {
      void setAppliedFilters({
        organizationSlug: organizationSlug.trim() || null,
        status: status === "all" ? null : status,
      });
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
          <AsyncSearchCombobox<AdminOrganizationOption>
            id="filter-organizationSlug"
            value={selectedFilterOrganization}
            onChange={(org) => {
              setSelectedFilterOrganization(org);
              setOrganizationSlug(org?.slug ?? "");
            }}
            search={searchOrganizationsClient}
            getKey={(org) => org.id}
            getTriggerLabel={(org) => org.name}
            renderOption={(org) => (
              <span className="flex flex-col">
                <span>{org.name}</span>
                <span className="text-muted-foreground text-xs">
                  {org.slug}
                </span>
              </span>
            )}
            labels={orgLabels}
            allowClear
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
