import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ContractForm } from "@/components/admin/enterprise-contracts/contract-form";
import { ContractLoadError } from "@/components/admin/enterprise-contracts/contract-load-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEnterpriseContractAction } from "@/lib/actions/enterprise-contract/action";
import { CommonErrorCode } from "@/lib/actions/errors";
import { adminOrganizationService } from "@/lib/services/admin-organization.service";

export const metadata: Metadata = {
  title: "Edit enterprise contract",
  description: "Edit a draft enterprise contract",
};

interface EditEnterpriseContractPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditEnterpriseContractPage({
  params,
}: EditEnterpriseContractPageProps) {
  const { id } = await params;
  const result = await getEnterpriseContractAction({ id });

  if (!result.ok) {
    if (result.error.code === CommonErrorCode.NOT_FOUND) {
      notFound();
    }

    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
          <Button variant="outline" asChild>
            <Link href="/admin/enterprise-contracts">Back to list</Link>
          </Button>
          <ContractLoadError message={result.error.message} />
        </div>
      </div>
    );
  }

  if (result.value.status !== "draft") {
    redirect(`/admin/enterprise-contracts/${id}`);
  }

  const initialOrganization =
    await adminOrganizationService.getOrganizationOptionBySlug(
      result.value.organizationSlug,
    );

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Edit draft contract
            </h1>
            <p className="text-muted-foreground text-sm">
              Only draft contracts can be edited.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/admin/enterprise-contracts/${id}`}>
              Back to detail
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{result.value.organizationSlug}</CardTitle>
          </CardHeader>
          <CardContent>
            <ContractForm
              mode="edit"
              contract={result.value}
              initialOrganization={initialOrganization}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
