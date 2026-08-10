"use client";

import type {
  PaidSubscriptionPlanName,
  SelfServeSubscriptionPlanName,
} from "@sokosumi/utils";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { PlaceholderOrb } from "@/components/aurora-orb";
import {
  formatPlanPrice,
  resolvePlanFeatureItems,
} from "@/components/billing/subscription-plan-presentation";
import { getPlanTranslationKey } from "@/components/billing/subscription-plan-utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CommonErrorCode } from "@/lib/actions/errors";
import { upgradePersonalSubscription } from "@/lib/actions/subscription";
import { cn } from "@/lib/utils";

/** Where a plan link falls back to when it can't be a direct checkout —
 * org-billed plans need a seat count the org's own subscription page
 * collects, so those still route there instead of guessing a seat count.
 * Also matches `resolveLowCreditsBillingPath`'s free-plan branch. */
const SUBSCRIPTION_BILLING_PATH = "/billing?tab=subscription";

export interface SubscriptionWallPlan {
  name: SelfServeSubscriptionPlanName;
  monthlyAmount: number;
  currency: string;
  credits: number;
}

interface SubscriptionRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The paid plans to preview. Empty when the catalog couldn't be loaded —
   * the wall still works with just the "Maybe later" / compare-plans path. */
  plans: SubscriptionWallPlan[];
  /** Null on a personal account — clicking a plan goes straight to Stripe
   * Checkout. Set when billing is org-owned, since upgrading an org plan
   * needs a seat count the org's own subscription page collects; those
   * plans link there instead of guessing a seat count here. */
  activeOrganizationId: string | null;
}

/** The wall: shown when a free-plan user tries to activate the personal
 * assistant. Viewing the pitch (EmptyState) stays open to everyone — this
 * only blocks the action. Previews the real plans (name, price, credits,
 * top features) and jumps straight to Stripe Checkout for personal
 * accounts, rather than a single generic "upgrade" button. */
export function SubscriptionRequiredDialog({
  open,
  onOpenChange,
  plans,
  activeOrganizationId,
}: SubscriptionRequiredDialogProps) {
  const t = useTranslations("App.Hermes.SubscriptionWall");
  const tCommon = useTranslations("App.Hermes.Common");
  const tPlans = useTranslations("App.Subscriptions");
  const formatter = useFormatter();
  const router = useRouter();
  const [pendingPlan, setPendingPlan] =
    useState<SelfServeSubscriptionPlanName | null>(null);

  async function handlePlanClick(plan: SelfServeSubscriptionPlanName) {
    // Org-billed plans need a seat count — send those to the org's own
    // subscription page rather than guessing one here.
    if (activeOrganizationId) {
      router.push(SUBSCRIPTION_BILLING_PATH);
      return;
    }

    setPendingPlan(plan);
    try {
      const result = await upgradePersonalSubscription({
        plan: plan as PaidSubscriptionPlanName,
        // Land back on this page after checkout — with the new plan active,
        // the activate button just works on the next click.
        returnPath: "/personal-assistant",
      });

      if (!result.ok) {
        switch (result.error.code) {
          case CommonErrorCode.UNAUTHENTICATED:
            toast.error(tPlans("Errors.unauthenticated"), {
              action: {
                label: tPlans("Errors.unauthenticatedAction"),
                onClick: () => router.push("/login"),
              },
            });
            break;
          case CommonErrorCode.BAD_INPUT:
            toast.error(tPlans("Errors.badInput"));
            break;
          default:
            toast.error(tPlans("Errors.general"));
            break;
        }
        return;
      }

      if (result.value.mode === "redirect") {
        window.location.href = result.value.url;
        return;
      }

      // No checkout needed (rare from a free plan, but handle it) — reflect
      // the new plan and close the wall.
      onOpenChange(false);
      router.refresh();
    } finally {
      setPendingPlan(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <div className="relative mb-1 flex items-center justify-center">
            <div
              aria-hidden
              className="bg-primary/10 absolute size-24 rounded-full blur-2xl"
            />
            <PlaceholderOrb
              size={144}
              expression="happy"
              className="relative size-16"
              alt={tCommon("hermesAvatarAlt")}
            />
          </div>
          <DialogTitle className="text-xl">{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {plans.length > 0 ? (
          <ul className="flex flex-col gap-1.5 py-1">
            {plans.map((plan) => {
              const translationKey = getPlanTranslationKey(plan.name);
              const price = formatPlanPrice({
                formatCurrency: (amount) =>
                  formatter.number(amount, {
                    style: "currency",
                    currency: plan.currency.toUpperCase(),
                    notation: "compact",
                  }),
                freePriceLabel: tPlans("freePrice"),
                monthlyAmount: plan.monthlyAmount,
              });
              const features = resolvePlanFeatureItems(
                tPlans.raw(`Plans.${translationKey}.features.items`),
              ).slice(0, 2);
              const isPending = pendingPlan === plan.name;
              const isDisabled = pendingPlan !== null;

              return (
                <li key={plan.name}>
                  <button
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handlePlanClick(plan.name)}
                    className={cn(
                      "group border-border/60 flex w-full flex-col gap-2 rounded-lg border px-3.5 py-3 text-left transition-colors",
                      isDisabled
                        ? "opacity-60"
                        : "hover:border-border hover:bg-muted/40",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-foreground text-sm font-medium">
                        {tPlans(`Plans.${translationKey}.name`)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="text-foreground text-sm font-semibold">
                          {price}
                        </span>
                        {isPending ? (
                          <Loader2
                            aria-hidden
                            className="text-muted-foreground size-4 animate-spin"
                          />
                        ) : (
                          <ChevronRight
                            aria-hidden
                            className="text-muted-foreground group-hover:text-foreground size-4 transition-colors"
                          />
                        )}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {tPlans("includedCredits", { credits: plan.credits })}
                    </span>
                    {features.length > 0 ? (
                      <ul className="flex flex-col gap-1">
                        {features.map((feature) => (
                          <li
                            key={feature}
                            className="text-foreground/80 flex items-start gap-1.5 text-xs leading-snug"
                          >
                            <Check
                              aria-hidden
                              className="text-semantic-success mt-0.5 size-3 shrink-0"
                            />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Button type="button" variant="primary" className="w-full" asChild>
            <Link href={SUBSCRIPTION_BILLING_PATH}>{t("cta")}</Link>
          </Button>
        )}

        <DialogFooter className="mt-1 sm:flex-col sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            {t("dismiss")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
