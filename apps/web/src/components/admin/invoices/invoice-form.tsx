"use client";

import { hasStripeBillingAddressWithCountry } from "@sokosumi/utils";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { StripeBillingInformationContent } from "@/components/billing/stripe-billing-information-content";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  searchOrganizationsClient,
  searchUsersClient,
} from "@/lib/actions/admin-search/client";
import {
  createAdminInvoiceAction,
  getAdminRecipientBillingDetailsAction,
} from "@/lib/actions/invoice-admin/action";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import type { AdminUserOption } from "@/lib/services/admin-user.service";
import type {
  CreditPriceOption,
  InvoiceTargetType,
} from "@/lib/services/invoice-admin.service";

interface InvoiceFormProps {
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

function countDecimals(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const text = String(value);
  const dotIndex = text.indexOf(".");
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}

export function InvoiceForm({ prices }: InvoiceFormProps) {
  const t = useTranslations("App.Admin.Invoices");
  const tOrg = useTranslations("Components.OrganizationCombobox");
  const tUser = useTranslations("Components.UserCombobox");
  const router = useRouter();
  const formatter = useFormatter();
  const defaultPriceId = prices[0]?.id ?? "";
  const priceFractionDigits = Math.max(
    2,
    ...prices.map((price) => countDecimals(price.amountPerCredit) + 2),
  );
  const [targetType, setTargetType] =
    useState<InvoiceTargetType>("organization");
  const [selectedOrg, setSelectedOrg] =
    useState<AdminOrganizationOption | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserOption | null>(
    null,
  );
  const [creditsInput, setCreditsInput] = useState("");
  const [expiryDaysInput, setExpiryDaysInput] = useState("");
  const [priceId, setPriceId] = useState(defaultPriceId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [billingDetails, setBillingDetails] =
    useState<StripeCustomerBillingDetails | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [billingLoadError, setBillingLoadError] = useState<string | null>(null);

  const orgLabels = buildComboboxLabels(tOrg);
  const userLabels = buildComboboxLabels(tUser);

  const selectedTargetId =
    targetType === "user" ? selectedUser?.id : selectedOrg?.id;
  const hasCompleteBilling =
    billingDetails !== null &&
    hasStripeBillingAddressWithCountry(billingDetails.address);
  const canCreateInvoice =
    Boolean(selectedTargetId) &&
    !isBillingLoading &&
    billingLoadError === null &&
    hasCompleteBilling &&
    !isSubmitting;

  function clearBillingState() {
    setBillingDetails(null);
    setBillingLoadError(null);
    setIsBillingLoading(false);
  }

  async function loadRecipientBillingDetails(
    nextTargetType: InvoiceTargetType,
    targetId: string,
  ) {
    setIsBillingLoading(true);
    setBillingLoadError(null);
    setBillingDetails(null);

    try {
      const result = await getAdminRecipientBillingDetailsAction({
        targetType: nextTargetType,
        targetId,
      });
      if (!result.ok) {
        setBillingLoadError(result.error.message ?? t("Form.billingLoadError"));
        return;
      }
      setBillingDetails(result.data);
    } finally {
      setIsBillingLoading(false);
    }
  }

  function handleTargetTypeChange(value: string) {
    const nextTargetType = value as InvoiceTargetType;
    setTargetType(nextTargetType);
    clearBillingState();

    const targetId =
      nextTargetType === "user" ? selectedUser?.id : selectedOrg?.id;
    if (targetId) {
      void loadRecipientBillingDetails(nextTargetType, targetId);
    }
  }

  function handleOrganizationChange(org: AdminOrganizationOption | null) {
    setSelectedOrg(org);
    if (!org) {
      clearBillingState();
      return;
    }
    void loadRecipientBillingDetails("organization", org.id);
  }

  function handleUserChange(user: AdminUserOption | null) {
    setSelectedUser(user);
    if (!user) {
      clearBillingState();
      return;
    }
    void loadRecipientBillingDetails("user", user.id);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const targetId = targetType === "user" ? selectedUser?.id : selectedOrg?.id;
    if (!targetId) {
      toast.error(t("Form.targetRequired"));
      return;
    }

    if (!hasCompleteBilling) {
      toast.error(t("Form.billingIncomplete"));
      return;
    }

    const credits = parseOptionalPositiveInteger(creditsInput);
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
      const result = await createAdminInvoiceAction({
        targetType,
        targetId,
        credits,
        ttlDays,
        priceId: priceId || null,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Form.createError"));
        return;
      }
      toast.success(t("Form.createSuccess"));
      router.push(`/admin/invoices/${result.data.invoiceId}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-3">
        <Label htmlFor="target">{t("Form.Fields.target")}</Label>
        <Tabs value={targetType} onValueChange={handleTargetTypeChange}>
          <TabsList>
            <TabsTrigger value="organization">
              {t("Form.Tabs.organization")}
            </TabsTrigger>
            <TabsTrigger value="user">{t("Form.Tabs.user")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {targetType === "organization" ? (
          <AsyncSearchCombobox<AdminOrganizationOption>
            id="target"
            value={selectedOrg}
            onChange={handleOrganizationChange}
            search={searchOrganizationsClient}
            getKey={(org) => org.id}
            getTriggerLabel={(org) => org.name}
            renderOption={(org) => (
              <span className="flex flex-col">
                <span>{org.name}</span>
                <span className="text-muted-foreground text-xs">
                  {org.slug}
                </span>
              </span>
            )}
            labels={orgLabels}
          />
        ) : (
          <AsyncSearchCombobox<AdminUserOption>
            id="target"
            value={selectedUser}
            onChange={handleUserChange}
            search={searchUsersClient}
            getKey={(user) => user.id}
            getTriggerLabel={(user) => user.name}
            renderOption={(user) => (
              <span className="flex flex-col">
                <span>{user.name}</span>
                <span className="text-muted-foreground text-xs">
                  {user.email}
                </span>
              </span>
            )}
            labels={userLabels}
          />
        )}
      </div>

      {selectedTargetId ? (
        <section
          aria-labelledby="invoice-recipient-billing"
          className="bg-muted/30 space-y-4 rounded-lg border p-4"
        >
          <h3 className="text-sm font-medium" id="invoice-recipient-billing">
            {t("Form.BillingDetails.title")}
          </h3>

          {isBillingLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : null}

          {!isBillingLoading && billingLoadError ? (
            <p className="text-destructive flex items-start gap-2 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-medium">
                  {t("Form.billingLoadErrorTitle")}.{" "}
                </span>
                {billingLoadError}
              </span>
            </p>
          ) : null}

          {!isBillingLoading && !billingLoadError && billingDetails ? (
            <>
              <StripeBillingInformationContent
                billingDetails={billingDetails}
                translationNamespace="App.Admin.Invoices.Form.BillingDetails"
              />
              {!hasCompleteBilling ? (
                <p className="text-destructive border-t pt-3 text-sm">
                  {targetType === "organization"
                    ? t("Form.billingIncompleteOrganization")
                    : t("Form.billingIncompleteUser")}
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <div className="space-y-6">
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
                    {formatter.number(price.amountPerCredit / 100, {
                      style: "currency",
                      currency: price.currency.toUpperCase(),
                      minimumFractionDigits: priceFractionDigits,
                      maximumFractionDigits: priceFractionDigits,
                    })}
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
      </div>

      <div className="flex justify-end border-t pt-6">
        <Button type="submit" disabled={!canCreateInvoice}>
          {isSubmitting ? t("Form.submitting") : t("Form.submit")}
        </Button>
      </div>
    </form>
  );
}
