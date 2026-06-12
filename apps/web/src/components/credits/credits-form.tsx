"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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
import type { Organization } from "@/lib/clients/generated/core";
import type {
  CreditTopUpPriceCatalog,
  Price,
} from "@/lib/clients/stripe.client";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  type CreditTopUpLookupKey,
  getCreditTopUpLookupKeyByCredits,
  getCreditTopUpTotalMinorUnits,
  isPositiveIntegerCredits,
} from "@/lib/stripe/credit-topup-pricing";
import { cn } from "@/lib/utils";

function hasValidCreditsInput(credits: number | null | undefined): boolean {
  return isPositiveIntegerCredits(credits ?? Number.NaN);
}

interface CreditPricingSummary {
  baseTierTotalMinorUnits: number;
  hasDiscountComparison: boolean;
  price: Price;
  savingsMinorUnits: number | null;
  totalMinorUnits: number;
}

function getCreditPricingSummary(
  credits: number,
  priceCatalog: CreditTopUpPriceCatalog,
  priceLookupKeyOverride?: CreditTopUpLookupKey,
): CreditPricingSummary {
  const selectedLookupKey = getCreditTopUpLookupKeyByCredits(
    credits,
    priceLookupKeyOverride,
  );
  const price = priceCatalog[selectedLookupKey];

  if (!price) {
    throw new Error(`Missing credit top-up price for ${selectedLookupKey}`);
  }

  const baseTierPrice = priceCatalog[BASE_CREDIT_TOPUP_LOOKUP_KEY];

  if (!baseTierPrice) {
    throw new Error(
      `Missing credit top-up price for ${BASE_CREDIT_TOPUP_LOOKUP_KEY}`,
    );
  }

  const totalMinorUnits = getCreditTopUpTotalMinorUnits(
    credits,
    price.amountPerCredit,
  );
  const baseTierTotalMinorUnits = getCreditTopUpTotalMinorUnits(
    credits,
    baseTierPrice.amountPerCredit,
  );
  const hasDiscountComparison =
    baseTierPrice.currency === price.currency &&
    baseTierTotalMinorUnits > totalMinorUnits;

  return {
    baseTierTotalMinorUnits,
    hasDiscountComparison,
    price,
    savingsMinorUnits: hasDiscountComparison
      ? baseTierTotalMinorUnits - totalMinorUnits
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
  priceCatalog: CreditTopUpPriceCatalog;
  organization: Organization | null;
  priceLookupKeyOverride?: CreditTopUpLookupKey;
  returnPath?: string;
}

export default function CreditsForm({
  isPurchaseEnabled = true,
  priceCatalog,
  organization,
  priceLookupKeyOverride,
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
      : getCreditPricingSummary(
          selectedCredits,
          priceCatalog,
          priceLookupKeyOverride,
        );
  const selectedPrice = selectedPricing?.price ?? null;
  const formattedSelectedTotal =
    selectedPricing === null
      ? null
      : formatter.number(selectedPricing.totalMinorUnits / 100, {
          style: "currency",
          currency: selectedPricing.price.currency.toUpperCase(),
          notation: "compact",
        });
  const formattedBaseTierTotal =
    selectedPricing === null || !selectedPricing.hasDiscountComparison
      ? null
      : formatter.number(selectedPricing.baseTierTotalMinorUnits / 100, {
          style: "currency",
          currency: selectedPricing.price.currency.toUpperCase(),
          notation: "compact",
        });
  const formattedSavings =
    selectedPricing?.savingsMinorUnits === null ||
    selectedPricing?.savingsMinorUnits === undefined
      ? null
      : formatter.number(selectedPricing.savingsMinorUnits / 100, {
          style: "currency",
          currency: selectedPricing.price.currency.toUpperCase(),
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
                    const pricing = getCreditPricingSummary(
                      amount,
                      priceCatalog,
                      priceLookupKeyOverride,
                    );
                    const formattedTotal = formatter.number(
                      pricing.totalMinorUnits / 100,
                      {
                        style: "currency",
                        currency: pricing.price.currency.toUpperCase(),
                        notation: "compact",
                      },
                    );
                    const formattedCompareAt = pricing.hasDiscountComparison
                      ? formatter.number(
                          pricing.baseTierTotalMinorUnits / 100,
                          {
                            style: "currency",
                            currency: pricing.price.currency.toUpperCase(),
                            notation: "compact",
                          },
                        )
                      : null;
                    const formattedPerCredit = formatter.number(
                      pricing.price.amountPerCredit / 100,
                      {
                        style: "currency",
                        currency: pricing.price.currency.toUpperCase(),
                        maximumFractionDigits: 4,
                      },
                    );
                    const formattedCardSavings =
                      pricing.savingsMinorUnits === null
                        ? null
                        : formatter.number(pricing.savingsMinorUnits / 100, {
                            style: "currency",
                            currency: pricing.price.currency.toUpperCase(),
                            notation: "compact",
                          });
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
              selectedPrice ? (
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
                        selectedPrice.amountPerCredit / 100,
                        {
                          style: "currency",
                          currency: selectedPrice.currency.toUpperCase(),
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
