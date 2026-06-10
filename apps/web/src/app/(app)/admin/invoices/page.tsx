import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { CreditGrantInvoiceList } from "@/components/admin/invoices/credit-grant-invoice-list";
import { Button } from "@/components/ui/button";
import { creditGrantAdminService } from "@/lib/services/credit-grant-admin.service";

export const metadata: Metadata = {
  title: "Invoices",
  description: "Grant one-time credits to a user or organization",
};

export default async function CreditGrantsPage() {
  const t = await getTranslations("App.Admin.CreditGrants");
  const invoices = await creditGrantAdminService.listGrantInvoices();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button asChild>
            <Link href="/admin/invoices/new">{t("newGrant")}</Link>
          </Button>
        </div>

        <CreditGrantInvoiceList initialInvoices={invoices} />
      </div>
    </div>
  );
}
