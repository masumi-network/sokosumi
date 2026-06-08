"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { OrganizationCombobox } from "@/components/admin/organization-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  createCreditGrantInvoiceAction,
  markCreditGrantInvoicePaidAction,
} from "@/lib/actions/credit-grant/action";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import type {
  CreditGrantInvoiceSummary,
  CreditPriceOption,
} from "@/lib/services/credit-grant-admin.service";

interface CreditGrantFormProps {
  organizations: AdminOrganizationOption[];
  prices: CreditPriceOption[];
}

function parseOptionalPositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatCurrency(minorUnits: number, currency: string): string {
  if (!currency) {
    return String(minorUnits);
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(minorUnits / 100);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function countDecimals(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const text = String(value);
  const dotIndex = text.indexOf(".");
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}

function formatPricePerCredit(
  amountPerCredit: number,
  currency: string,
  fractionDigits: number,
): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amountPerCredit / 100);
  } catch {
    return `${(amountPerCredit / 100).toFixed(fractionDigits)} ${currency.toUpperCase()}`;
  }
}

export function CreditGrantForm({
  organizations,
  prices,
}: CreditGrantFormProps) {
  const t = useTranslations("App.Admin.CreditGrants");
  const defaultPriceId = prices[0]?.id ?? "";
  // Pad every price to the same number of decimals so the values line up in
  // the dropdown (combined with tabular-nums on render).
  const priceFractionDigits = Math.max(
    2,
    ...prices.map((price) => countDecimals(price.amountPerCredit) + 2),
  );
  const [organizationId, setOrganizationId] = useState("");
  const [creditsInput, setCreditsInput] = useState("");
  const [expiryDaysInput, setExpiryDaysInput] = useState("");
  const [priceId, setPriceId] = useState(defaultPriceId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [invoice, setInvoice] = useState<CreditGrantInvoiceSummary | null>(
    null,
  );

  const isPaid = invoice?.status === "paid";

  function handleBack() {
    setInvoice(null);
    setOrganizationId("");
    setCreditsInput("");
    setExpiryDaysInput("");
    setPriceId(defaultPriceId);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const credits = parseOptionalPositiveInteger(creditsInput);
    if (!organizationId) {
      toast.error(t("Form.organizationRequired"));
      return;
    }
    if (credits === null) {
      toast.error(t("Form.creditsRequired"));
      return;
    }
    if (prices.length > 0 && !priceId) {
      toast.error(t("Form.priceRequired"));
      return;
    }

    const ttlDays = expiryDaysInput.trim()
      ? parseOptionalPositiveInteger(expiryDaysInput)
      : null;
    if (expiryDaysInput.trim() && ttlDays === null) {
      toast.error(t("Form.expiryInvalid"));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createCreditGrantInvoiceAction({
        organizationId,
        credits,
        ttlDays,
        priceId: priceId || null,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Form.createError"));
        return;
      }
      setInvoice(result.data);
      toast.success(t("Form.createSuccess"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMarkPaid() {
    if (!invoice) {
      return;
    }
    setIsMarkingPaid(true);
    try {
      const result = await markCreditGrantInvoicePaidAction({
        invoiceId: invoice.invoiceId,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Result.paidError"));
        return;
      }
      setInvoice(result.data);
      toast.success(t("Result.paidSuccess"));
    } finally {
      setIsMarkingPaid(false);
    }
  }

  if (invoice) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("Result.heading")}</h3>
          <p className="text-muted-foreground text-xs">
            {isPaid ? t("Result.paidHelper") : t("Result.pendingHelper")}
          </p>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs">
              {t("Result.organization")}
            </dt>
            <dd className="text-sm font-medium">{invoice.organizationName}</dd>
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
              {formatCurrency(invoice.amountDue, invoice.currency)}
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
          <Button variant="outline" onClick={handleBack}>
            {t("Result.back")}
          </Button>
          {!isPaid ? (
            <Button onClick={handleMarkPaid} disabled={isMarkingPaid}>
              {isMarkingPaid ? t("Result.marking") : t("Result.markPaid")}
            </Button>
          ) : null}
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="organization">{t("Form.Fields.organization")}</Label>
        <OrganizationCombobox
          id="organization"
          organizations={organizations}
          value={organizationId}
          onChange={(org) => setOrganizationId(org?.id ?? "")}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="price">{t("Form.Fields.price")}</Label>
        <Select value={priceId} onValueChange={setPriceId}>
          <SelectTrigger id="price" className="w-full">
            <SelectValue placeholder={t("Form.pricePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {prices.map((price) => (
              <SelectItem key={price.id} value={price.id}>
                <span className="tabular-nums">
                  {formatPricePerCredit(
                    price.amountPerCredit,
                    price.currency,
                    priceFractionDigits,
                  )}
                </span>
                {price.nickname ? (
                  <span className="text-muted-foreground">
                    {price.nickname}
                  </span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">{t("Form.priceHelper")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="credits">{t("Form.Fields.credits")}</Label>
          <Input
            id="credits"
            type="number"
            min={1}
            step={1}
            value={creditsInput}
            onChange={(event) => setCreditsInput(event.target.value)}
            required
          />
          <p className="text-muted-foreground text-xs">
            {t("Form.creditsHelper")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="expiryDays">{t("Form.Fields.expiryDays")}</Label>
          <Input
            id="expiryDays"
            type="number"
            min={1}
            step={1}
            value={expiryDaysInput}
            onChange={(event) => setExpiryDaysInput(event.target.value)}
            placeholder={t("Form.expiryPlaceholder")}
          />
          <p className="text-muted-foreground text-xs">
            {t("Form.expiryHelper")}
          </p>
        </div>
      </div>

      <Separator />

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t("Form.submitting") : t("Form.submit")}
      </Button>
    </form>
  );
}
