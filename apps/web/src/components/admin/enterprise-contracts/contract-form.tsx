"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { OrganizationCombobox } from "@/components/admin/organization-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  createEnterpriseContractAction,
  updateEnterpriseContractAction,
} from "@/lib/actions/enterprise-contract/action";
import type {
  CreateEnterpriseContractRequest,
  EnterpriseContract,
  PatchEnterpriseContractRequest,
} from "@/lib/clients/generated/core/types.gen";
import {
  formatDatetimeLocalValue,
  parseDatetimeLocalValue,
} from "@/lib/job-input/date-value";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";

const MIN_CREDITS_PER_MONTH = 60_000;
const MIN_PERIODS = 1;
const MIN_SEATS = 1;

export interface ContractFormValues {
  organizationSlug: string;
  creditsPerMonth: number;
  periods: number;
  seats: number;
  oneTimeCredits: number | null;
  oneTimeExpiresAt: string;
  paymentReference: string;
  notes: string;
  externalReference: string;
}

function toContractDate(value: Date | string | null | undefined): Date | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatOneTimeExpiresAtField(
  value: Date | string | null | undefined,
): string {
  const date = toContractDate(value);
  return date ? formatDatetimeLocalValue(date) : "";
}

function toFormValues(contract?: EnterpriseContract): ContractFormValues {
  return {
    organizationSlug: contract?.organizationSlug ?? "",
    creditsPerMonth: contract?.creditsPerMonth ?? MIN_CREDITS_PER_MONTH,
    periods: contract?.periods ?? MIN_PERIODS,
    seats: contract?.seats ?? MIN_SEATS,
    oneTimeCredits: contract?.oneTimeCredits ?? null,
    oneTimeExpiresAt: formatOneTimeExpiresAtField(contract?.oneTimeExpiresAt),
    paymentReference: contract?.paymentReference ?? "",
    notes: contract?.notes ?? "",
    externalReference: contract?.externalReference ?? "",
  };
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveOneTimeCredits(values: ContractFormValues): number | null {
  if (values.oneTimeCredits == null || values.oneTimeCredits <= 0) {
    return null;
  }

  return values.oneTimeCredits;
}

function resolveOneTimeExpiresAt(
  values: ContractFormValues,
  originalOneTimeExpiresAt?: Date | string | null,
): Date | null {
  if (
    resolveOneTimeCredits(values) == null ||
    !values.oneTimeExpiresAt.trim()
  ) {
    return null;
  }

  const trimmed = values.oneTimeExpiresAt.trim();
  const originalDate = toContractDate(originalOneTimeExpiresAt);

  if (originalDate && trimmed === formatDatetimeLocalValue(originalDate)) {
    return originalDate;
  }

  return parseDatetimeLocalValue(trimmed) ?? null;
}

function buildCreateBody(
  values: ContractFormValues,
): CreateEnterpriseContractRequest {
  const body: CreateEnterpriseContractRequest = {
    organizationSlug: values.organizationSlug.trim(),
    creditsPerMonth: values.creditsPerMonth,
    periods: values.periods,
    seats: values.seats,
  };

  const oneTimeCredits = resolveOneTimeCredits(values);
  if (oneTimeCredits != null) {
    body.oneTimeCredits = oneTimeCredits;
    const oneTimeExpiresAt = resolveOneTimeExpiresAt(values);
    if (oneTimeExpiresAt) {
      body.oneTimeExpiresAt = oneTimeExpiresAt;
    }
  }

  if (values.paymentReference.trim()) {
    body.paymentReference = values.paymentReference.trim();
  }
  if (values.notes.trim()) {
    body.notes = values.notes.trim();
  }
  if (values.externalReference.trim()) {
    body.externalReference = values.externalReference.trim();
  }

  return body;
}

function buildPatchBody(
  values: ContractFormValues,
  originalOneTimeExpiresAt?: Date | string | null,
): PatchEnterpriseContractRequest {
  return {
    creditsPerMonth: values.creditsPerMonth,
    periods: values.periods,
    seats: values.seats,
    oneTimeCredits: resolveOneTimeCredits(values),
    oneTimeExpiresAt: resolveOneTimeExpiresAt(values, originalOneTimeExpiresAt),
    paymentReference: values.paymentReference.trim() || null,
    notes: values.notes.trim() || null,
    externalReference: values.externalReference.trim() || null,
  };
}

interface ContractFormProps {
  mode: "create" | "edit";
  contract?: EnterpriseContract;
  organizations: AdminOrganizationOption[];
}

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

function FormSection({
  title,
  description,
  children,
  className,
}: FormSectionProps) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="text-muted-foreground text-xs">{description}</p>
        ) : null}
      </div>
      <div className={className ?? "grid gap-4 sm:grid-cols-2"}>{children}</div>
    </section>
  );
}

export function ContractForm({
  mode,
  contract,
  organizations,
}: ContractFormProps) {
  const t = useTranslations("App.Admin.EnterpriseContracts.Form");
  const router = useRouter();
  const [values, setValues] = useState<ContractFormValues>(() =>
    toFormValues(contract),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedOrganizationId =
    organizations.find((org) => org.slug === values.organizationSlug)?.id ?? "";

  function updateValue<K extends keyof ContractFormValues>(
    key: K,
    value: ContractFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (mode === "create") {
        const result = await createEnterpriseContractAction({
          body: buildCreateBody(values),
        });
        if (!result.ok) {
          toast.error(result.error.message ?? t("createError"));
          return;
        }
        toast.success(t("createSuccess"));
        router.push(`/admin/enterprise-contracts/${result.data.id}`);
        router.refresh();
        return;
      }

      if (!contract) {
        toast.error(t("missingContract"));
        return;
      }

      const result = await updateEnterpriseContractAction({
        id: contract.id,
        body: buildPatchBody(values, contract.oneTimeExpiresAt),
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("updateError"));
        return;
      }

      toast.success(t("updateSuccess"));
      router.push(`/admin/enterprise-contracts/${contract.id}`);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <FormSection title={t("Sections.organization")} className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="organizationSlug">
            {t("Fields.organizationSlug.label")}
          </Label>
          <OrganizationCombobox
            id="organizationSlug"
            organizations={organizations}
            value={selectedOrganizationId}
            onChange={(org) => updateValue("organizationSlug", org?.slug ?? "")}
            disabled={mode === "edit"}
          />
        </div>
      </FormSection>

      <Separator />

      <FormSection
        title={t("Sections.subscription")}
        className="grid gap-4 sm:grid-cols-3"
      >
        <div className="space-y-2">
          <Label htmlFor="creditsPerMonth">
            {t("Fields.creditsPerMonth.label")}
          </Label>
          <Input
            id="creditsPerMonth"
            type="number"
            min={MIN_CREDITS_PER_MONTH}
            step={1}
            value={values.creditsPerMonth}
            onChange={(event) =>
              updateValue(
                "creditsPerMonth",
                Number(event.target.value) || MIN_CREDITS_PER_MONTH,
              )
            }
            required
          />
          <p className="text-muted-foreground text-xs">
            {t("Fields.creditsPerMonth.min", { min: MIN_CREDITS_PER_MONTH })}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="periods">{t("Fields.periods.label")}</Label>
          <Input
            id="periods"
            type="number"
            min={MIN_PERIODS}
            step={1}
            value={values.periods}
            onChange={(event) =>
              updateValue("periods", Number(event.target.value) || MIN_PERIODS)
            }
            required
          />
          <p className="text-muted-foreground text-xs">
            {t("Fields.periods.helper")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="seats">{t("Fields.seats.label")}</Label>
          <Input
            id="seats"
            type="number"
            min={MIN_SEATS}
            step={1}
            value={values.seats}
            onChange={(event) =>
              updateValue("seats", Number(event.target.value) || MIN_SEATS)
            }
            required
          />
        </div>
      </FormSection>

      <Separator />

      <FormSection
        title={t("Sections.oneTime")}
        description={t("optionalSection")}
      >
        <div className="space-y-2">
          <Label htmlFor="oneTimeCredits">
            {t("Fields.oneTimeCredits.label")}
          </Label>
          <Input
            id="oneTimeCredits"
            type="number"
            min={0}
            step={1}
            value={values.oneTimeCredits ?? ""}
            onChange={(event) =>
              updateValue(
                "oneTimeCredits",
                parseOptionalNumber(event.target.value),
              )
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="oneTimeExpiresAt">
            {t("Fields.oneTimeExpiresAt.label")}
          </Label>
          <Input
            id="oneTimeExpiresAt"
            type="datetime-local"
            value={values.oneTimeExpiresAt}
            onChange={(event) =>
              updateValue("oneTimeExpiresAt", event.target.value)
            }
          />
          <p className="text-muted-foreground text-xs">
            {t("Fields.oneTimeExpiresAt.helper")}
          </p>
        </div>
      </FormSection>

      <Separator />

      <FormSection
        title={t("Sections.references")}
        description={t("optionalSection")}
        className="grid gap-4"
      >
        <div className="space-y-2">
          <Label htmlFor="paymentReference">
            {t("Fields.paymentReference.label")}
          </Label>
          <Input
            id="paymentReference"
            value={values.paymentReference}
            onChange={(event) =>
              updateValue("paymentReference", event.target.value)
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="externalReference">
            {t("Fields.externalReference.label")}
          </Label>
          <Input
            id="externalReference"
            value={values.externalReference}
            onChange={(event) =>
              updateValue("externalReference", event.target.value)
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">{t("Fields.notes.label")}</Label>
          <Textarea
            id="notes"
            value={values.notes}
            onChange={(event) => updateValue("notes", event.target.value)}
            rows={4}
          />
        </div>
      </FormSection>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {mode === "create" ? t("createDraft") : t("saveChanges")}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link
            href={
              contract
                ? `/admin/enterprise-contracts/${contract.id}`
                : "/admin/enterprise-contracts"
            }
          >
            {t("cancel")}
          </Link>
        </Button>
      </div>
    </form>
  );
}
