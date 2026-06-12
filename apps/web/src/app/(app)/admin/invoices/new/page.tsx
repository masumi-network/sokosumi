import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { InvoiceForm } from "@/components/admin/invoices/invoice-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { invoiceAdminService } from "@/lib/services/invoice-admin.service";

export const metadata: Metadata = {
  title: "New invoice",
  description: "Grant one-time credits to a user or organization",
};

export default async function NewInvoicePage() {
  const t = await getTranslations("App.Admin.Invoices");
  const prices = await invoiceAdminService.listPrices();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("cardTitle")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/invoices">{t("backToList")}</Link>
          </Button>
        </div>

        <Card>
          <CardContent>
            <InvoiceForm prices={prices} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
