"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  getCreditTopUpTotalMinorUnits,
  isPositiveIntegerCredits,
  selectCreditTopUpTier,
} from "@sokosumi/utils";
import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  CommonErrorCode,
  CreditsErrorCode,
  purchaseCredits,
} from "@/lib/actions";
import type {
  CreditTopUpPricing,
  Organization,
} from "@/lib/clients/generated/core";
import { fireGTMEvent } from "@/lib/gtm-events";
import { cn } from "@/lib/utils";

function hasValidCreditsInput(credits: number | null | undefined): boolean {
  return isPositiveIntegerCredits(credits ?? Number.NaN);
}

interface CreditPricingSummary {
  amountPerCredit: number;
  currency: string;
  hasDiscountComparison: boolean;
  referenceTotalMinorUnits: number;
  savingsMinorUnits: number | null;
  totalMinorUnits: number;
}

function getCreditPricingSummary(
  credits: number,
  pricing: CreditTopUpPricing,
): CreditPricingSummary {
  const tier = selectCreditTopUpTier(pricing.tiers, credits);
  const totalMinorUnits = getCreditTopUpTotalMinorUnits(
    credits,
    tier.amountPerCredit,
  );
  const referenceTotalMinorUnits = getCreditTopUpTotalMinorUnits(
    credits,
    pricing.referenceAmountPerCredit,
  );
  const hasDiscountComparison = referenceTotalMinorUnits > totalMinorUnits;

  return {
    amountPerCredit: tier.amountPerCredit,
    currency: pricing.currency,
    hasDiscountComparison,
    referenceTotalMinorUnits,
    savingsMinorUnits: hasDiscountComparison
      ? referenceTotalMinorUnits - totalMinorUnits
      : null,
    totalMinorUnits,
  };
}

const creditsFormSchema = (t: IntlTranslation<"App.Credits">) =>
  z
    .object({
      credits: z.number().nullish(),
    })
    .superRefine((data, ctx) => {
      const hasValidCredits = hasValidCreditsInput(data.credits);
      if (!hasValidCredits) {
        ctx.addIssue({
          code: "custom",
          message: t("Errors.invalidCredits"),
          path: ["credits"],
        });
      }
    });

type CreditsFormData = z.infer<ReturnType<typeof creditsFormSchema>>;

interface CreditsFormProps {
  isPurchaseEnabled?: boolean;
  pricing: CreditTopUpPricing;
  organization: Organization | null;
  returnPath?: string;
}

export default function CreditsForm({
  isPurchaseEnabled = true,
  pricing,
  organization,
  returnPath,
}: CreditsFormProps) {
  const quickAmounts = [5_000, 20_000, 50_000, 100_000];
  const t = useTranslations("App.Credits");
  const formatter = useFormatter();
  const router = useRouter();

  const form = useForm<CreditsFormData>({
    resolver: zodResolver(creditsFormSchema(t)),
    defaultValues: {
      credits: null,
    },
  });

  // Effect is necessary: Analytics tracking when component is displayed
  // Fires once on mount to track page view
  useEffect(() => {
    fireGTMEvent.viewCredits();
  }, []);

  const { setValue } = form;
  const credits = useWatch({
    control: form.control,
    name: "credits",
  });

  const handleFieldChange = useCallback(
    (value: number | undefined) => {
      setValue("credits", value);
    },
    [setValue],
  );

  const handleSubmit = useCallback(
    async (data: CreditsFormData) => {
      if (!isPurchaseEnabled) {
        toast.error(t("Errors.invalidCredits"));
        return;
      }

      if (!hasValidCreditsInput(data.credits)) {
        toast.error(t("Errors.invalidCredits"));
        return;
      }

      const creditsAmount = data.credits as number;
      const result = await purchaseCredits({
        organizationId: organization?.id ?? null,
        credits: creditsAmount,
        returnPath,
      });

      if (result.ok) {
        fireGTMEvent.beginCheckout();
        window.location.href = result.data.url;
      } else {
        switch (result.error.code) {
          case CommonErrorCode.UNAUTHENTICATED:
            toast.error(t("Errors.unauthenticated"), {
              action: {
                label: t("Errors.unauthenticatedAction"),
                onClick: () => {
                  router.push(`/login`);
                },
              },
            });
            break;
          case CreditsErrorCode.INVALID_CREDITS:
            toast.error(t("Errors.invalidCredits"));
            break;
          case CommonErrorCode.UNAUTHORIZED:
            if (organization) {
              toast.error(t("Errors.unauthorizedOrganization"));
            } else {
              toast.error(t("Errors.unauthorizedPersonal"));
            }
            break;
          default:
            toast.error(t("Error.title"));
        }
      }
    },
    [isPurchaseEnabled, organization, returnPath, router, t],
  );

  const handleQuickAmount = useCallback(
    (amount: number) => {
      handleFieldChange(amount);
    },
    [handleFieldChange],
  );

  const { isSubmitting } = form.formState;
  const hasValidCreditsValue =
    hasValidCreditsInput(credits) && isPurchaseEnabled;
  const selectedCredits = hasValidCreditsValue ? (credits as number) : null;
  const selectedPricing =
    selectedCredits === null
      ? null
      : getCreditPricingSummary(selectedCredits, pricing);
  const formattedSelectedTotal =
    selectedPricing === null
      ? null
      : formatter.number(selectedPricing.totalMinorUnits / 100, {
          style: "currency",
          currency: selectedPricing.currency.toUpperCase(),
          notation: "compact",
        });
  const formattedBaseTierTotal =
    selectedPricing === null || !selectedPricing.hasDiscountComparison
      ? null
      : formatter.number(selectedPricing.referenceTotalMinorUnits / 100, {
          style: "currency",
          currency: selectedPricing.currency.toUpperCase(),
          notation: "compact",
        });
  const formattedSavings =
    selectedPricing?.savingsMinorUnits === null ||
    selectedPricing?.savingsMinorUnits === undefined
      ? null
      : formatter.number(selectedPricing.savingsMinorUnits / 100, {
          style: "currency",
          currency: selectedPricing.currency.toUpperCase(),
          notation: "compact",
        });
  const isQuickAmountSelected =
    selectedCredits !== null && quickAmounts.includes(selectedCredits);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("topUpTitle")}</CardTitle>
        <CardDescription>
          {isPurchaseEnabled && organization ? (
            <div className="flex items-center gap-2">
              <Building2 className="size-4" />
              {t("purchaseForOrganization", {
                organization: organization.name,
              })}
            </div>
          ) : isPurchaseEnabled ? (
            t("topUpDescription")
          ) : (
            t("paidSubscriptionRequiredDescription")
          )}
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <CardContent className="space-y-4">
            {isPurchaseEnabled ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {quickAmounts.map((amount) => {
                    const pricingSummary = getCreditPricingSummary(
                      amount,
                      pricing,
                    );
                    const formattedTotal = formatter.number(
                      pricingSummary.totalMinorUnits / 100,
                      {
                        style: "currency",
                        currency: pricingSummary.currency.toUpperCase(),
                        notation: "compact",
                      },
                    );
                    const formattedCompareAt =
                      pricingSummary.hasDiscountComparison
                        ? formatter.number(
                            pricingSummary.referenceTotalMinorUnits / 100,
                            {
                              style: "currency",
                              currency: pricingSummary.currency.toUpperCase(),
                              notation: "compact",
                            },
                          )
                        : null;
                    const formattedPerCredit = formatter.number(
                      pricingSummary.amountPerCredit / 100,
                      {
                        style: "currency",
                        currency: pricingSummary.currency.toUpperCase(),
                        maximumFractionDigits: 4,
                      },
                    );
                    const formattedCardSavings =
                      pricingSummary.savingsMinorUnits === null
                        ? null
                        : formatter.number(
                            pricingSummary.savingsMinorUnits / 100,
                            {
                              style: "currency",
                              currency: pricingSummary.currency.toUpperCase(),
                              notation: "compact",
                            },
                          );
                    const isSelected = selectedCredits === amount;

                    return (
                      <Button
                        key={amount}
                        type="button"
                        variant="outline"
                        aria-pressed={isSelected}
                        onClick={() => handleQuickAmount(amount)}
                        disabled={isSubmitting}
                        className={cn(
                          "h-auto min-h-36 w-full flex-col items-start justify-between gap-6 whitespace-normal rounded-xl px-4 py-4 text-left",
                          isSelected
                            ? "border-primary ring-primary bg-primary/5 border shadow-sm ring-1 hover:bg-primary/5"
                            : "hover:bg-accent/40",
                        )}
                      >
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            {t("creditAmount", { count: amount })}
                          </p>
                          <p className="text-2xl font-medium md:text-3xl">
                            {formattedTotal}
                          </p>
                          {formattedCompareAt ? (
                            <p className="text-muted-foreground text-xs line-through">
                              {formattedCompareAt}
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-1">
                          {formattedCardSavings ? (
                            <p className="text-primary text-xl font-medium">
                              {t("youSaveLabel", {
                                amount: formattedCardSavings,
                              })}
                            </p>
                          ) : null}
                          <p className="text-muted-foreground text-xs">
                            {t("costPerCredit", {
                              cost: formattedPerCredit,
                            })}
                          </p>
                        </div>
                      </Button>
                    );
                  })}
                </div>
                <FormField
                  control={form.control}
                  name="credits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("creditsLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder={t("creditsPlaceholder")}
                          min="1"
                          step="1"
                          disabled={isSubmitting}
                          {...field}
                          onChange={(e) => {
                            const { value } = e.target;
                            if (value === "") {
                              handleFieldChange(undefined);
                            } else {
                              const numValue = Number(value);
                              if (Number.isFinite(numValue) && numValue >= 0) {
                                handleFieldChange(numValue);
                              }
                            }
                          }}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("paidSubscriptionRequiredHint")}
              </p>
            )}
          </CardContent>
          {isPurchaseEnabled ? (
            <CardFooter
              className={cn(
                "gap-4 pt-6",
                isQuickAmountSelected
                  ? "justify-start"
                  : "flex items-start justify-between",
              )}
            >
              <Button
                type="submit"
                disabled={isSubmitting || !hasValidCreditsValue}
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {organization ? t("topUpButtonOrganization") : t("topUpButton")}
              </Button>
              {!isQuickAmountSelected &&
              selectedCredits !== null &&
              selectedPricing !== null ? (
                <div className="space-y-1 text-right">
                  {formattedSelectedTotal ? (
                    <p className="text-2xl font-medium md:text-3xl">
                      {formattedSelectedTotal}
                    </p>
                  ) : null}
                  {formattedBaseTierTotal ? (
                    <p className="text-muted-foreground text-sm line-through">
                      {formattedBaseTierTotal}
                    </p>
                  ) : null}
                  {formattedSavings ? (
                    <p className="text-primary text-sm font-medium">
                      {t("youSaveLabel", { amount: formattedSavings })}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-sm">
                    {t("costPerCredit", {
                      cost: formatter.number(
                        selectedPricing.amountPerCredit / 100,
                        {
                          style: "currency",
                          currency: selectedPricing.currency.toUpperCase(),
                          maximumFractionDigits: 4,
                        },
                      ),
                    })}
                  </p>
                </div>
              ) : null}
            </CardFooter>
          ) : null}
        </form>
      </Form>
    </Card>
  );
}
