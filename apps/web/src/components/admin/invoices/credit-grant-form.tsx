"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  searchOrganizationsClient,
  searchUsersClient,
} from "@/lib/actions/admin-search/client";
import { createCreditGrantInvoiceAction } from "@/lib/actions/credit-grant/action";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import type { AdminUserOption } from "@/lib/services/admin-user.service";
import type {
  CreditGrantTargetType,
  CreditPriceOption,
} from "@/lib/services/credit-grant-admin.service";

interface CreditGrantFormProps {
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

export function CreditGrantForm({ prices }: CreditGrantFormProps) {
  const t = useTranslations("App.Admin.CreditGrants");
  const tOrg = useTranslations("Components.OrganizationCombobox");
  const tUser = useTranslations("Components.UserCombobox");
  const router = useRouter();
  const defaultPriceId = prices[0]?.id ?? "";
  // Pad every price to the same number of decimals so the values line up in
  // the dropdown (combined with tabular-nums on render).
  const priceFractionDigits = Math.max(
    2,
    ...prices.map((price) => countDecimals(price.amountPerCredit) + 2),
  );
  const [targetType, setTargetType] =
    useState<CreditGrantTargetType>("organization");
  const [selectedOrg, setSelectedOrg] =
    useState<AdminOrganizationOption | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserOption | null>(
    null,
  );
  const [creditsInput, setCreditsInput] = useState("");
  const [expiryDaysInput, setExpiryDaysInput] = useState("");
  const [priceId, setPriceId] = useState(defaultPriceId);
  const [markFree, setMarkFree] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const orgLabels = buildComboboxLabels(tOrg);
  const userLabels = buildComboboxLabels(tUser);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const targetId = targetType === "user" ? selectedUser?.id : selectedOrg?.id;
    if (!targetId) {
      toast.error(t("Form.targetRequired"));
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
      const result = await createCreditGrantInvoiceAction({
        targetType,
        targetId,
        credits,
        ttlDays,
        priceId: priceId || null,
        markFree,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Form.createError"));
        return;
      }
      toast.success(t("Form.createSuccess"));
      // The invoice detail page doubles as the post-creation summary view.
      router.push(`/admin/invoices/${result.data.invoiceId}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="target">{t("Form.Fields.target")}</Label>
        <Tabs
          value={targetType}
          onValueChange={(value) =>
            setTargetType(value as CreditGrantTargetType)
          }
        >
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
            onChange={setSelectedOrg}
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
            onChange={setSelectedUser}
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
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="markFree">{t("Form.Fields.markFree")}</Label>
          <p className="text-muted-foreground text-xs">
            {t("Form.markFreeHelper")}
          </p>
        </div>
        <Switch
          id="markFree"
          checked={markFree}
          onCheckedChange={setMarkFree}
        />
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
