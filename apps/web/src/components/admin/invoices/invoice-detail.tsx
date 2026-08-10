"use client";

import { ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { InvoiceDeleteButton } from "@/components/admin/invoices/invoice-delete-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { markAdminInvoicePaidAction } from "@/lib/actions/invoice-admin/action";
import type { InvoiceSummary } from "@/lib/services/invoice-admin.service";

interface InvoiceDetailProps {
  invoice: InvoiceSummary;
}

export function InvoiceDetail({ invoice: initialInvoice }: InvoiceDetailProps) {
  const t = useTranslations("App.Admin.Invoices");
  const formatter = useFormatter();
  const [invoice, setInvoice] = useState<InvoiceSummary>(initialInvoice);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  const isPaid = invoice.status === "paid";
  const targetLabel =
    invoice.targetType === "user" ? t("Result.user") : t("Result.organization");

  async function handleMarkPaid() {
    setIsMarkingPaid(true);
    try {
      const result = await markAdminInvoicePaidAction({
        invoiceId: invoice.invoiceId,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Result.paidError"));
        return;
      }
      setInvoice(result.value);
      toast.success(t("Result.paidSuccess"));
    } finally {
      setIsMarkingPaid(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-xs">
        {isPaid ? t("Result.paidHelper") : t("Result.pendingHelper")}
      </p>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="text-muted-foreground text-xs">{targetLabel}</dt>
          <dd className="text-sm font-medium">{invoice.targetName}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground text-xs">
            {t("Result.credits")}
          </dt>
          <dd className="text-sm font-medium">
            {invoice.credits.toLocaleString("en-US")}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground text-xs">
            {t("Result.expiry")}
          </dt>
          <dd className="text-sm font-medium">
            {invoice.ttlDays
              ? t("Result.expiryDays", { days: invoice.ttlDays })
              : t("Result.noExpiry")}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground text-xs">
            {t("Result.amount")}
          </dt>
          <dd className="text-sm font-medium">
            {invoice.currency
              ? formatter.number(invoice.amountDue / 100, {
                  style: "currency",
                  currency: invoice.currency.toUpperCase(),
                })
              : invoice.amountDue}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground text-xs">
            {t("Result.status")}
          </dt>
          <dd className="text-sm font-medium capitalize">
            {invoice.status ?? "—"}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground text-xs">
            {t("Result.invoiceId")}
          </dt>
          <dd className="font-mono text-sm">{invoice.invoiceId}</dd>
        </div>
      </dl>

      <Separator />

      <div className="flex flex-wrap gap-2">
        {!isPaid ? (
          <Button onClick={handleMarkPaid} disabled={isMarkingPaid}>
            {isMarkingPaid ? t("Result.marking") : t("Result.markPaid")}
          </Button>
        ) : null}
        <InvoiceDeleteButton
          invoiceId={invoice.invoiceId}
          status={invoice.status}
          size="default"
          redirectToList
        />
        <Button variant="outline" asChild>
          <a
            href={invoice.dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="size-4" />
            {t("Result.openInStripe")}
          </a>
        </Button>
      </div>
    </div>
  );
}
