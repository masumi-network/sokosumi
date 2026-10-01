"use client";

import type { AdCampaign } from "@sokosumi/core-client";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAdCampaign } from "@/lib/actions/ads/action";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

import {
  budgetStep,
  currencyFractionDigits,
  hasValidPrecision,
} from "../format-ads";

interface DialogProps {
  accountId: string;
  campaign: AdCampaign;
  onClose: () => void;
  projectId: string;
}

/** Pause or resume, confirmed. No optimistic update: the page refetches. */
export function AdsCampaignStatusDialog({
  accountId,
  campaign,
  nextStatus,
  onClose,
  projectId,
}: DialogProps & { nextStatus: "ACTIVE" | "PAUSED" }) {
  const t = useTranslations("App.Ads.campaigns");
  const copy = nextStatus === "PAUSED" ? "pauseDialog" : "resumeDialog";

  async function confirm(): Promise<void> {
    try {
      const result = await updateAdCampaign({
        projectId,
        accountId,
        campaignId: campaign.id,
        status: nextStatus,
      });
      if (result.ok) {
        toast.success(t("success.updated"));
      } else {
        toast.error(t("errors.update"));
      }
    } catch {
      toast.error(t("errors.update"));
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`${copy}.title`, { name: campaign.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(`${copy}.description`)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>
            {t(`${copy}.confirm`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Edit the daily budget. The number input steps by the currency's smallest
 * unit; Core's own refusals (a budget shared by other campaigns, a bad
 * precision) show inline and keep the dialog open.
 */
export function AdsCampaignBudgetDialog({
  accountId,
  campaign,
  currency,
  onClose,
  projectId,
}: DialogProps & { currency: string }) {
  const t = useTranslations("App.Ads.campaigns.budgetDialog");
  const tCommon = useTranslations("App.Ads.campaigns");
  const locale = useLocale();
  const digits = currencyFractionDigits(currency, locale);
  const [value, setValue] = useState(
    campaign.dailyBudget === null ? "" : String(campaign.dailyBudget),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function validate(): number | null {
    const budget = Number(value);
    if (value.trim() === "" || !Number.isFinite(budget) || budget <= 0) {
      setError(t("errors.required"));
      return null;
    }
    if (!hasValidPrecision(budget, digits)) {
      setError(
        digits === 0
          ? t("errors.wholeNumber", { currency })
          : t("errors.precision", { digits, currency }),
      );
      return null;
    }
    return budget;
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const dailyBudget = validate();
    if (dailyBudget === null) return;

    setError(null);
    setIsSaving(true);
    try {
      const result = await updateAdCampaign({
        projectId,
        accountId,
        campaignId: campaign.id,
        dailyBudget,
      });
      if (result.ok) {
        toast.success(tCommon("success.updated"));
        onClose();
      } else {
        setError(
          result.error.code === CommonErrorCode.BAD_INPUT &&
            result.error.message
            ? result.error.message
            : tCommon("errors.update"),
        );
      }
    } catch {
      setError(tCommon("errors.update"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form className="grid gap-4" noValidate onSubmit={(e) => void save(e)}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {t("description", { name: campaign.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="ads-daily-budget">{t("label", { currency })}</Label>
            <Input
              aria-describedby={error ? "ads-daily-budget-error" : undefined}
              aria-invalid={error ? true : undefined}
              id="ads-daily-budget"
              inputMode="decimal"
              min={0}
              onChange={(event) => setValue(event.target.value)}
              step={budgetStep(currency, locale)}
              type="number"
              value={value}
            />
            {error ? (
              <p
                className="text-destructive text-sm"
                id="ads-daily-budget-error"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="ghost">
              {tCommon("cancel")}
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
