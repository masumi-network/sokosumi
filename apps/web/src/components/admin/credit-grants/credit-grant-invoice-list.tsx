"use client";

import { ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  searchOrganizationsClient,
  searchUsersClient,
} from "@/lib/actions/admin-search/client";
import { listCreditGrantInvoicesAction } from "@/lib/actions/credit-grant/action";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import type { AdminUserOption } from "@/lib/services/admin-user.service";
import type {
  CreditGrantInvoiceListItem,
  CreditGrantInvoiceStatusFilter,
  CreditGrantTargetType,
} from "@/lib/services/credit-grant-admin.service";

interface CreditGrantInvoiceListProps {
  initialInvoices: CreditGrantInvoiceListItem[];
}

const STATUS_FILTERS = [
  "unfinished",
  "all",
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
] as const satisfies readonly CreditGrantInvoiceStatusFilter[];

const STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  open: "default",
  draft: "secondary",
  paid: "outline",
  void: "destructive",
  uncollectible: "destructive",
};

export function CreditGrantInvoiceList({
  initialInvoices,
}: CreditGrantInvoiceListProps) {
  const t = useTranslations("App.Admin.CreditGrants.InvoiceList");
  const tOrg = useTranslations("Components.OrganizationCombobox");
  const tUser = useTranslations("Components.UserCombobox");
  const formatter = useFormatter();

  const [invoices, setInvoices] =
    useState<CreditGrantInvoiceListItem[]>(initialInvoices);
  const [status, setStatus] =
    useState<CreditGrantInvoiceStatusFilter>("unfinished");
  const [recipientType, setRecipientType] =
    useState<CreditGrantTargetType>("organization");
  const [selectedOrg, setSelectedOrg] =
    useState<AdminOrganizationOption | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserOption | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  const orgLabels = buildComboboxLabels(tOrg, {
    placeholder: t("Filters.recipientAll"),
    clear: t("Filters.recipientAll"),
  });
  const userLabels = buildComboboxLabels(tUser, {
    placeholder: t("Filters.recipientAll"),
    clear: t("Filters.recipientAll"),
  });

  const selectedRecipient =
    recipientType === "user" ? selectedUser : selectedOrg;
  const recipientId = selectedRecipient?.id ?? null;

  // Re-fetch whenever a filter changes. Skips the initial mount because the
  // server already provided the default (unfinished) list as `initialInvoices`.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    startTransition(async () => {
      const result = await listCreditGrantInvoicesAction({
        status,
        recipient: recipientId
          ? { targetType: recipientType, targetId: recipientId }
          : null,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("loadError"));
        return;
      }
      setInvoices(result.data);
    });
  }, [status, recipientId, recipientType, t]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <Label htmlFor="filter-status">{t("Filters.status")}</Label>
          <Select
            value={status}
            onValueChange={(value) =>
              setStatus(value as CreditGrantInvoiceStatusFilter)
            }
          >
            <SelectTrigger id="filter-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`Status.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-recipient">{t("Filters.recipient")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Tabs
              value={recipientType}
              onValueChange={(value) =>
                setRecipientType(value as CreditGrantTargetType)
              }
            >
              <TabsList>
                <TabsTrigger value="organization">
                  {t("Filters.tabOrganization")}
                </TabsTrigger>
                <TabsTrigger value="user">{t("Filters.tabUser")}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex-1">
              {recipientType === "organization" ? (
                <AsyncSearchCombobox<AdminOrganizationOption>
                  id="filter-recipient"
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
                  allowClear
                />
              ) : (
                <AsyncSearchCombobox<AdminUserOption>
                  id="filter-recipient"
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
                  allowClear
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {invoices.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div
          className="overflow-hidden rounded-lg border"
          aria-busy={isPending}
        >
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
                const statusVariant = invoice.status
                  ? (STATUS_BADGE_VARIANT[invoice.status] ?? "outline")
                  : "outline";
                const recipientLabel =
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
                        {recipientLabel ? (
                          <span className="text-muted-foreground text-xs">
                            {recipientLabel}
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
      )}
    </div>
  );
}
