"use client";

import type { AdCampaign, ProjectAdProvider } from "@sokosumi/core-client";
import { MoreHorizontal } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAdCampaign } from "@/lib/actions/ads/action";
import {
  budgetStep,
  currencyFractionDigits,
  hasValidPrecision,
} from "@/lib/ads/campaign";

type CampaignDialog = "pause" | "resume" | "budget";

interface AdsCampaignActionsProps {
  accountId: string;
  campaign: AdCampaign;
  currency: string;
  projectId: string;
  provider: ProjectAdProvider;
}

interface DialogProps extends AdsCampaignActionsProps {
  onClose: () => void;
}

/**
 * A campaign row's menu and the dialogs it opens. Pause and resume ask first,
 * the budget dialog states the change before it saves, and nothing updates
 * optimistically: the action revalidates the page and the list refetches.
 */
export function AdsCampaignActions(props: AdsCampaignActionsProps) {
  const { campaign } = props;
  const t = useTranslations("App.Ads.campaigns.actions");
  const [dialog, setDialog] = useState<CampaignDialog | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("label", { name: campaign.name })}
            size="icon"
            type="button"
            variant="ghost"
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {campaign.status === "ACTIVE" ? (
            <DropdownMenuItem onSelect={() => setDialog("pause")}>
              {t("pause")}
            </DropdownMenuItem>
          ) : null}
          {campaign.status === "PAUSED" ? (
            <DropdownMenuItem onSelect={() => setDialog("resume")}>
              {t("resume")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setDialog("budget")}>
            {t("budget")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "budget" ? (
        <BudgetDialog {...props} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "pause" || dialog === "resume" ? (
        <StatusDialog
          {...props}
          nextStatus={dialog === "pause" ? "PAUSED" : "ACTIVE"}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function StatusDialog({
  accountId,
  campaign,
  nextStatus,
  onClose,
  projectId,
}: DialogProps & { nextStatus: "ACTIVE" | "PAUSED" }) {
  const t = useTranslations("App.Ads.campaigns");
  const copy = nextStatus === "PAUSED" ? "pauseDialog" : "resumeDialog";

  async function handleConfirm(): Promise<void> {
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
          <AlertDialogAction onClick={() => void handleConfirm()}>
            {t(`${copy}.confirm`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Edit the daily budget. The input steps by the currency's smallest unit and
 * the dialog says what will change before "Save budget". Core's refusals are
 * worded here by status (it is the one action in play), never from its text.
 */
function BudgetDialog({
  accountId,
  campaign,
  currency,
  onClose,
  projectId,
  provider,
}: DialogProps) {
  const t = useTranslations("App.Ads.campaigns.budgetDialog");
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const tProvider = useTranslations("App.Ads.accounts.providers");
  const formatter = useFormatter();
  const digits = currencyFractionDigits(currency);
  const [value, setValue] = useState(
    campaign.dailyBudget === null ? "" : String(campaign.dailyBudget),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const budget = Number(value);
  const isValid =
    value.trim() !== "" &&
    Number.isFinite(budget) &&
    budget > 0 &&
    hasValidPrecision(budget, digits);
  const isUnchanged = isValid && budget === campaign.dailyBudget;
  const money = (amount: number) =>
    formatter.number(amount, { style: "currency", currency });

  function precisionError(): string {
    return digits === 0
      ? t("errors.wholeNumber", { currency })
      : t("errors.precision", { digits, currency });
  }

  function validationError(): string | null {
    if (value.trim() === "" || !Number.isFinite(budget) || budget <= 0) {
      return t("errors.required");
    }
    return hasValidPrecision(budget, digits) ? null : precisionError();
  }

  function refusalError(status: number | undefined): string {
    if (status === 409) {
      return t("errors.shared", { provider: tProvider(provider) });
    }
    return status === 422 ? precisionError() : tCampaigns("errors.update");
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const invalid = validationError();
    if (invalid) {
      setError(invalid);
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const result = await updateAdCampaign({
        projectId,
        accountId,
        campaignId: campaign.id,
        dailyBudget: budget,
      });
      if (result.ok) {
        toast.success(tCampaigns("success.updated"));
        onClose();
      } else {
        setError(refusalError(result.error.status));
      }
    } catch {
      setError(tCampaigns("errors.update"));
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
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
        >
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
              step={budgetStep(digits)}
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
            {isValid && !isUnchanged ? (
              <p className="text-muted-foreground text-sm" role="status">
                {t("change", {
                  old:
                    campaign.dailyBudget === null
                      ? t("notSet")
                      : money(campaign.dailyBudget),
                  new: money(budget),
                })}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="ghost">
              {tCampaigns("cancel")}
            </Button>
            <Button disabled={isSaving || isUnchanged} type="submit">
              {isSaving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
