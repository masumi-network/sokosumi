import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ContractsTable } from "@/components/admin/enterprise-contracts/contracts-table";
import { Button } from "@/components/ui/button";
import { listEnterpriseContractsAction } from "@/lib/actions/enterprise-contract/action";
import type { EnterpriseContractStatus } from "@/lib/clients/generated/core/types.gen";
import { adminOrganizationService } from "@/lib/services/admin-organization.service";

export const metadata: Metadata = {
  title: "Enterprise contracts",
  description: "Internal admin console for enterprise contracts",
};

interface EnterpriseContractsPageProps {
  searchParams: Promise<{
    organizationSlug?: string;
    status?: string;
  }>;
}

function isEnterpriseContractStatus(
  value: string | undefined,
): value is EnterpriseContractStatus {
  return (
    value === "draft" ||
    value === "active" ||
    value === "completed" ||
    value === "canceled"
  );
}

async function EnterpriseContractsContent({
  searchParams,
}: EnterpriseContractsPageProps) {
  const t = await getTranslations("App.Admin.EnterpriseContracts");
  const params = await searchParams;
  const organizationSlug = params.organizationSlug?.trim() ?? "";
  const status = isEnterpriseContractStatus(params.status)
    ? params.status
    : undefined;

  const [result, initialFilterOrganization] = await Promise.all([
    listEnterpriseContractsAction({
      organizationSlug: organizationSlug || undefined,
      status,
    }),
    organizationSlug
      ? adminOrganizationService.getOrganizationOptionBySlug(organizationSlug)
      : Promise.resolve(null),
  ]);

  if (!result.ok) {
    return (
      <p className="text-destructive text-sm">
        {result.error.message ?? t("loadFailed")}
      </p>
    );
  }

  return (
    <ContractsTable
      contracts={result.value}
      initialFilterOrganization={initialFilterOrganization}
    />
  );
}

export default async function EnterpriseContractsPage(
  props: EnterpriseContractsPageProps,
) {
  const t = await getTranslations("App.Admin.EnterpriseContracts");

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button asChild>
            <Link href="/admin/enterprise-contracts/new">
              {t("newContract")}
            </Link>
          </Button>
        </div>

        <Suspense
          fallback={
            <p className="text-muted-foreground text-sm">{t("loading")}</p>
          }
        >
          <EnterpriseContractsContent searchParams={props.searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
