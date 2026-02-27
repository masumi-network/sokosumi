"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Organization } from "@sokosumi/database";
import { PAID_TOPUP_CREDITS_EXPIRY_DAYS } from "@sokosumi/database/helpers";
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
import { CreditTopUpPriceCatalog } from "@/lib/clients/stripe.client";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  getCreditTopUpLookupKeyByCredits,
  isPositiveIntegerCredits,
} from "@/lib/stripe/credit-topup-pricing";

function hasValidCreditsInput(credits: number | null | undefined): boolean {
  return isPositiveIntegerCredits(credits ?? Number.NaN);
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
  returnPath?: string;
}

export default function CreditsForm({
  isPurchaseEnabled = true,
  priceCatalog,
  organization,
  returnPath,
}: CreditsFormProps) {
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
  const selectedLookupKey = isPositiveIntegerCredits(credits ?? Number.NaN)
    ? getCreditTopUpLookupKeyByCredits(credits as number)
    : BASE_CREDIT_TOPUP_LOOKUP_KEY;
  const selectedPrice = priceCatalog[selectedLookupKey];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("topUpTitle")}</CardTitle>
        <CardDescription>
          {organization ? (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {t("purchaseForOrganization", {
                organization: organization.name,
              })}
            </div>
          ) : (
            t("topUpDescription")
          )}
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <CardContent className="space-y-4">
            {isPurchaseEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[5_000, 20_000, 50_000, 100_000].map((amount) => (
                    <Button
                      key={amount}
                      type="button"
                      variant="outline"
                      onClick={() => handleQuickAmount(amount)}
                      disabled={isSubmitting}
                    >
                      {t("creditAmount", { count: amount })}
                    </Button>
                  ))}
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
                {t("topUpDescription")}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex items-center justify-between pt-6">
            <Button
              type="submit"
              disabled={isSubmitting || !hasValidCreditsValue}
            >
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {organization ? t("topUpButtonOrganization") : t("topUpButton")}
            </Button>
            <div className="text-right">
              {isPurchaseEnabled ? (
                <p className="text-muted-foreground text-sm">
                  {t("costPerCredit", {
                    cost: formatter.number(selectedPrice.amountPerCredit / 100, {
                      style: "currency",
                      currency: selectedPrice.currency,
                      maximumFractionDigits: 4,
                    }),
                  })}
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                {t("expiryNotice", {
                  days: PAID_TOPUP_CREDITS_EXPIRY_DAYS,
                })}
              </p>
            </div>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
