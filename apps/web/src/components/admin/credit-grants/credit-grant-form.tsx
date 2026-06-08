"use client";

import { Check, ChevronsUpDown, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  createCreditGrantInvoiceAction,
  markCreditGrantInvoicePaidAction,
} from "@/lib/actions/credit-grant/action";
import type {
  AdminOrganizationOption,
  CreditGrantInvoiceSummary,
} from "@/lib/services/credit-grant-admin.service";
import { cn } from "@/lib/utils";

interface CreditGrantFormProps {
  organizations: AdminOrganizationOption[];
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

export function CreditGrantForm({ organizations }: CreditGrantFormProps) {
  const t = useTranslations("App.Admin.CreditGrants");
  const [organizationId, setOrganizationId] = useState("");
  const [creditsInput, setCreditsInput] = useState("");
  const [expiryDaysInput, setExpiryDaysInput] = useState("");
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [invoice, setInvoice] = useState<CreditGrantInvoiceSummary | null>(
    null,
  );

  const selectedOrganization = useMemo(
    () => organizations.find((org) => org.id === organizationId) ?? null,
    [organizations, organizationId],
  );

  const isPaid = invoice?.status === "paid";

  function resetForm() {
    setInvoice(null);
    setOrganizationId("");
    setCreditsInput("");
    setExpiryDaysInput("");
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
          {!isPaid ? (
            <Button onClick={handleMarkPaid} disabled={isMarkingPaid}>
              {isMarkingPaid ? t("Result.marking") : t("Result.markPaid")}
            </Button>
          ) : null}
          {invoice.hostedInvoiceUrl ? (
            <Button variant="outline" asChild>
              <a
                href={invoice.hostedInvoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-4" />
                {t("Result.openInStripe")}
              </a>
            </Button>
          ) : null}
          <Button variant="outline" onClick={resetForm}>
            {t("Result.newGrant")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="organization">{t("Form.Fields.organization")}</Label>
        <Popover open={orgPickerOpen} onOpenChange={setOrgPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              id="organization"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={orgPickerOpen}
              className="w-full justify-between font-normal"
            >
              <span
                className={cn(!selectedOrganization && "text-muted-foreground")}
              >
                {selectedOrganization
                  ? selectedOrganization.name
                  : t("Form.organizationPlaceholder")}
              </span>
              <ChevronsUpDown className="size-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-(--radix-popover-trigger-width) p-0"
            align="start"
          >
            <Command
              filter={(value, search) =>
                value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
              }
            >
              <CommandInput placeholder={t("Form.organizationSearch")} />
              <CommandList>
                <CommandEmpty>{t("Form.organizationEmpty")}</CommandEmpty>
                <CommandGroup>
                  {organizations.map((org) => (
                    <CommandItem
                      key={org.id}
                      value={`${org.name} ${org.slug}`}
                      onSelect={() => {
                        setOrganizationId(org.id);
                        setOrgPickerOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          organizationId === org.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span className="flex flex-col">
                        <span>{org.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {org.slug}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <Separator />

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
