import type { Metadata } from "next";
import Link from "next/link";

import { ContractForm } from "@/components/admin/enterprise-contracts/contract-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminOrganizationService } from "@/lib/services/admin-organization.service";

export const metadata: Metadata = {
  title: "New enterprise contract",
  description: "Create a draft enterprise contract",
};

export default async function NewEnterpriseContractPage() {
  const organizations = await adminOrganizationService.listOrganizations();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              New enterprise contract
            </h1>
            <p className="text-muted-foreground text-sm">
              Creates a draft contract. Activation happens from the detail page.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/enterprise-contracts">Back to list</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Draft details</CardTitle>
          </CardHeader>
          <CardContent>
            <ContractForm mode="create" organizations={organizations} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
