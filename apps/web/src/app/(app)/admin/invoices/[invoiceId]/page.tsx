import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { InvoiceDetail } from "@/components/admin/invoices/invoice-detail";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommonErrorCode } from "@/lib/actions/errors";
import { getAdminInvoiceAction } from "@/lib/actions/invoice-admin/action";

export const metadata: Metadata = {
  title: "Invoice",
  description: "Admin invoice detail",
};

interface InvoiceDetailPageProps {
  params: Promise<{ invoiceId: string }>;
}

export default async function InvoiceDetailPage({
  params,
}: InvoiceDetailPageProps) {
  const { invoiceId } = await params;
  const t = await getTranslations("App.Admin.Invoices");
  const result = await getAdminInvoiceAction({ invoiceId });

  if (!result.ok) {
    if (result.error.code === CommonErrorCode.NOT_FOUND) {
      notFound();
    }

    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
          <Button variant="outline" asChild>
            <Link href="/admin/invoices">{t("backToList")}</Link>
          </Button>
          <p className="text-destructive text-sm">
            {result.error.message ?? t("Result.loadError")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Result.heading")}
          </h1>
          <Button variant="outline" asChild>
            <Link href="/admin/invoices">{t("backToList")}</Link>
          </Button>
        </div>

        <Card>
          <CardContent>
            <InvoiceDetail invoice={result.data} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
