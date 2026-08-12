import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContractDetail } from "@/components/admin/enterprise-contracts/contract-detail";
import { ContractLoadError } from "@/components/admin/enterprise-contracts/contract-load-error";
import { Button } from "@/components/ui/button";
import { getEnterpriseContractAction } from "@/lib/actions/enterprise-contract/action";
import { CommonErrorCode } from "@/lib/actions/errors";

export const metadata: Metadata = {
  title: "Enterprise contract",
  description: "Enterprise contract detail",
};

interface EnterpriseContractDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function EnterpriseContractDetailPage({
  params,
}: EnterpriseContractDetailPageProps) {
  const { id } = await params;
  const result = await getEnterpriseContractAction({ id });

  if (!result.ok) {
    if (result.error.code === CommonErrorCode.NOT_FOUND) {
      notFound();
    }

    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
          <Button variant="outline" asChild>
            <Link href="/admin/enterprise-contracts">Back to list</Link>
          </Button>
          <ContractLoadError message={result.error.message} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <Button variant="outline" asChild>
          <Link href="/admin/enterprise-contracts">Back to list</Link>
        </Button>
        <ContractDetail contract={result.value} />
      </div>
    </div>
  );
}
