"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

function toFormValues(contract?: EnterpriseContract): ContractFormValues {
  return {
    organizationSlug: contract?.organizationSlug ?? "",
    creditsPerMonth: contract?.creditsPerMonth ?? MIN_CREDITS_PER_MONTH,
    periods: contract?.periods ?? MIN_PERIODS,
    seats: contract?.seats ?? MIN_SEATS,
    oneTimeCredits: contract?.oneTimeCredits ?? null,
    oneTimeExpiresAt: contract?.oneTimeExpiresAt
      ? toDateTimeLocalValue(contract.oneTimeExpiresAt)
      : "",
    paymentReference: contract?.paymentReference ?? "",
    notes: contract?.notes ?? "",
    externalReference: contract?.externalReference ?? "",
  };
}

function toDateTimeLocalValue(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
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

  if (values.oneTimeCredits != null && values.oneTimeCredits > 0) {
    body.oneTimeCredits = values.oneTimeCredits;
    if (values.oneTimeExpiresAt.trim()) {
      body.oneTimeExpiresAt = new Date(values.oneTimeExpiresAt);
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
): PatchEnterpriseContractRequest {
  return {
    creditsPerMonth: values.creditsPerMonth,
    periods: values.periods,
    seats: values.seats,
    oneTimeCredits: values.oneTimeCredits,
    oneTimeExpiresAt: values.oneTimeExpiresAt.trim()
      ? new Date(values.oneTimeExpiresAt)
      : null,
    paymentReference: values.paymentReference.trim() || null,
    notes: values.notes.trim() || null,
    externalReference: values.externalReference.trim() || null,
  };
}

interface ContractFormProps {
  mode: "create" | "edit";
  contract?: EnterpriseContract;
}

export function ContractForm({ mode, contract }: ContractFormProps) {
  const formatter = useFormatter();
  const router = useRouter();
  const [values, setValues] = useState<ContractFormValues>(() =>
    toFormValues(contract),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

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
          toast.error(result.error.message ?? "Failed to create contract");
          return;
        }
        toast.success("Draft contract created");
        router.push(`/admin/enterprise-contracts/${result.data.id}`);
        router.refresh();
        return;
      }

      if (!contract) {
        toast.error("Missing contract");
        return;
      }

      const result = await updateEnterpriseContractAction({
        id: contract.id,
        body: buildPatchBody(values),
      });
      if (!result.ok) {
        toast.error(result.error.message ?? "Failed to update contract");
        return;
      }

      toast.success("Contract updated");
      router.push(`/admin/enterprise-contracts/${contract.id}`);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="organizationSlug">Organization slug</Label>
          <Input
            id="organizationSlug"
            value={values.organizationSlug}
            onChange={(event) =>
              updateValue("organizationSlug", event.target.value)
            }
            required
            disabled={mode === "edit"}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="creditsPerMonth">Credits per month</Label>
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
            Minimum {formatter.number(MIN_CREDITS_PER_MONTH)} credits.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="periods">Periods</Label>
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
        </div>
        <div className="space-y-2">
          <Label htmlFor="seats">Seats</Label>
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
        <div className="space-y-2">
          <Label htmlFor="oneTimeCredits">One-time credits (optional)</Label>
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
          <Label htmlFor="oneTimeExpiresAt">One-time expiry (optional)</Label>
          <Input
            id="oneTimeExpiresAt"
            type="datetime-local"
            value={values.oneTimeExpiresAt}
            onChange={(event) =>
              updateValue("oneTimeExpiresAt", event.target.value)
            }
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="paymentReference">Payment reference (optional)</Label>
          <Input
            id="paymentReference"
            value={values.paymentReference}
            onChange={(event) =>
              updateValue("paymentReference", event.target.value)
            }
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="externalReference">
            External reference (optional)
          </Label>
          <Input
            id="externalReference"
            value={values.externalReference}
            onChange={(event) =>
              updateValue("externalReference", event.target.value)
            }
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            value={values.notes}
            onChange={(event) => updateValue("notes", event.target.value)}
            rows={4}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {mode === "create" ? "Create draft" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link
            href={
              contract
                ? `/admin/enterprise-contracts/${contract.id}`
                : "/admin/enterprise-contracts"
            }
          >
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}
