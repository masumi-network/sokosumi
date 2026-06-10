import { ExternalLink } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CreditGrantInvoiceListItem } from "@/lib/services/credit-grant-admin.service";

interface CreditGrantInvoiceListProps {
  invoices: CreditGrantInvoiceListItem[];
}

const STATUS_BADGE_VARIANT = {
  open: "default",
  draft: "secondary",
} as const satisfies Record<"open" | "draft", "default" | "secondary">;

export async function CreditGrantInvoiceList({
  invoices,
}: CreditGrantInvoiceListProps) {
  const t = await getTranslations("App.Admin.CreditGrants.InvoiceList");
  const formatter = await getFormatter();

  if (invoices.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="pl-4">{t("recipient")}</TableHead>
            <TableHead className="text-right">{t("credits")}</TableHead>
            <TableHead>{t("expiry")}</TableHead>
            <TableHead className="text-right">{t("amount")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead>{t("created")}</TableHead>
            <TableHead className="pr-4 text-right">
              <span className="sr-only">{t("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => {
            const statusVariant =
              invoice.status === "open" || invoice.status === "draft"
                ? STATUS_BADGE_VARIANT[invoice.status]
                : "outline";
            const recipientType =
              invoice.targetType === "user"
                ? t("typeUser")
                : invoice.targetType === "organization"
                  ? t("typeOrganization")
                  : null;
            return (
              <TableRow key={invoice.invoiceId}>
                <TableCell className="pl-4">
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {invoice.targetName ?? "—"}
                    </span>
                    {recipientType ? (
                      <span className="text-muted-foreground text-xs">
                        {recipientType}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatter.number(invoice.credits)}
                </TableCell>
                <TableCell>
                  {invoice.ttlDays
                    ? t("expiryDays", { days: invoice.ttlDays })
                    : t("noExpiry")}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {invoice.currency
                    ? formatter.number(invoice.amountDue / 100, {
                        style: "currency",
                        currency: invoice.currency.toUpperCase(),
                      })
                    : invoice.amountDue}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant} className="capitalize">
                    {invoice.status ?? "—"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatter.dateTime(new Date(invoice.createdAt), {
                    dateStyle: "medium",
                  })}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={invoice.dashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="size-4" />
                      {t("openInStripe")}
                    </a>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
