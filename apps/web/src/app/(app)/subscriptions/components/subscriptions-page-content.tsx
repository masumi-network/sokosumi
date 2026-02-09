"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CommonErrorCode } from "@/lib/actions";
import {
  openPersonalBillingPortal,
  upgradePersonalSubscription,
} from "@/lib/actions/subscription";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";
import { cn } from "@/lib/utils";

export interface SubscriptionPlanView {
  credits: number;
  currency: string;
  isCurrent: boolean;
  monthlyAmount: number;
  name: SubscriptionPlanName;
}

interface SubscriptionsPageContentProps {
  currentPlan: SubscriptionPlanName | null;
  plans: SubscriptionPlanView[];
  status: "cancel" | "success" | null;
}

function getPlanTranslationKey(plan: SubscriptionPlanName): string {
  switch (plan) {
    case "free":
      return "free";
    case "starter":
      return "starter";
    case "standard":
      return "standard";
    case "pro":
      return "pro";
    default: {
      const _exhaustive: never = plan;
      return _exhaustive;
    }
  }
}

export default function SubscriptionsPageContent({
  currentPlan,
  plans,
  status,
}: SubscriptionsPageContentProps) {
  const t = useTranslations("App.Subscriptions");
  const formatter = useFormatter();
  const router = useRouter();

  const [pendingPlan, setPendingPlan] = useState<SubscriptionPlanName | null>(
    null,
  );
  const [isBillingPortalPending, setIsBillingPortalPending] = useState(false);

  const statusMessage = useMemo(() => {
    if (status === "success") {
      return t("statusSuccess");
    }
    if (status === "cancel") {
      return t("statusCancel");
    }
    return null;
  }, [status, t]);

  const handleUpgradePlan = useCallback(
    async (plan: SubscriptionPlanName) => {
      setPendingPlan(plan);
      try {
        const result = await upgradePersonalSubscription({
          plan,
        });

        if (!result.ok) {
          switch (result.error.code) {
            case CommonErrorCode.UNAUTHENTICATED:
              toast.error(t("Errors.unauthenticated"), {
                action: {
                  label: t("Errors.unauthenticatedAction"),
                  onClick: () => {
                    router.push("/login");
                  },
                },
              });
              break;
            case CommonErrorCode.BAD_INPUT:
              toast.error(t("Errors.badInput"));
              break;
            default:
              toast.error(t("Errors.general"));
              break;
          }
          return;
        }

        window.location.href = result.data.url;
      } finally {
        setPendingPlan(null);
      }
    },
    [router, t],
  );

  const handleOpenBillingPortal = useCallback(async () => {
    setIsBillingPortalPending(true);
    try {
      const result = await openPersonalBillingPortal({});
      if (!result.ok) {
        switch (result.error.code) {
          case CommonErrorCode.UNAUTHENTICATED:
            toast.error(t("Errors.unauthenticated"), {
              action: {
                label: t("Errors.unauthenticatedAction"),
                onClick: () => {
                  router.push("/login");
                },
              },
            });
            break;
          default:
            toast.error(t("Errors.general"));
            break;
        }
        return;
      }

      window.location.href = result.data.url;
    } finally {
      setIsBillingPortalPending(false);
    }
  }, [router, t]);

  function formatPrice(monthlyAmount: number, currency: string): string {
    if (monthlyAmount === 0) {
      return t("freePrice");
    }

    return formatter.number(monthlyAmount / 100, {
      style: "currency",
      currency: currency.toUpperCase(),
    });
  }

  return (
    <div className="w-full space-y-8 px-2">
      <div className="space-y-2">
        <h1 className="text-2xl font-light md:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      {statusMessage ? (
        <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-md px-4 py-3 text-sm">
          <CheckCircle2 className="size-4" />
          <span>{statusMessage}</span>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const isPlanPending = pendingPlan === plan.name;
          const isAnyPlanPending = pendingPlan !== null;
          const translationKey = getPlanTranslationKey(plan.name);

          return (
            <Card
              key={plan.name}
              className={cn(
                "flex h-full flex-col",
                plan.isCurrent ? "border-primary" : undefined,
              )}
            >
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center justify-between">
                  <span>{t(`Plans.${translationKey}.name`)}</span>
                  {plan.isCurrent ? (
                    <span className="text-primary text-xs font-medium">
                      {t("currentPlanBadge")}
                    </span>
                  ) : null}
                </CardTitle>
                <CardDescription>
                  {t(`Plans.${translationKey}.description`)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-light">
                  {formatPrice(plan.monthlyAmount, plan.currency)}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t("pricePerMonth")}
                </p>
                <p className="text-sm">
                  {t("includedCredits", { credits: plan.credits })}
                </p>
              </CardContent>
              <CardFooter className="mt-auto">
                <Button
                  className="w-full"
                  variant={plan.isCurrent ? "outline" : "default"}
                  disabled={isAnyPlanPending || plan.isCurrent}
                  onClick={() => void handleUpgradePlan(plan.name)}
                >
                  {isPlanPending ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {t("upgrading")}
                    </>
                  ) : plan.isCurrent ? (
                    t("currentPlanCta")
                  ) : (
                    t("upgradePlanCta")
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{t("billingPortalTitle")}</CardTitle>
            <CardDescription>
              {currentPlan
                ? t("billingPortalDescriptionWithPlan", {
                    plan: t(`Plans.${getPlanTranslationKey(currentPlan)}.name`),
                  })
                : t("billingPortalDescription")}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant="outline"
              className="w-full"
              disabled={isBillingPortalPending}
              onClick={() => void handleOpenBillingPortal()}
            >
              {isBillingPortalPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t("openingBillingPortal")}
                </>
              ) : (
                t("billingPortalCta")
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
