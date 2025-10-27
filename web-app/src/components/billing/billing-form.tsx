"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
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
  BillingErrorCode,
  claimFreeCreditsWithCoupon,
  CommonErrorCode,
  purchaseCredits,
} from "@/lib/actions";
import { Price } from "@/lib/clients/stripe.client";
import { fireGTMEvent } from "@/lib/gtm-events";
import { Organization } from "@/prisma/generated/client";

const billingFormSchema = (t: IntlTranslation<"App.Billing">) =>
  z
    .object({
      credits: z.number().nullish(),
      coupon: z.string().nullish(),
    })
    .superRefine((data, ctx) => {
      const hasValidCredits = data.credits != null && data.credits > 0;
      const hasValidCoupon =
        data.coupon != null && data.coupon.trim().length > 0;
      const hasCreditsAttempt = data.credits != null;
      const hasCouponAttempt =
        data.coupon != null && data.coupon.trim().length > 0;
      const path =
        hasCreditsAttempt && !hasCouponAttempt ? ["credits"] : ["coupon"];

      if (!hasValidCredits && !hasValidCoupon) {
        ctx.addIssue({
          code: "custom",
          message: t("Errors.invalidInput"),
          path,
        });
      }
    });

type BillingFormData = z.infer<ReturnType<typeof billingFormSchema>>;

interface BillingFormProps {
  price: Price;
  organization: Organization | null;
}

export default function BillingForm({ price, organization }: BillingFormProps) {
  const t = useTranslations("App.Billing");
  const formatter = useFormatter();
  const router = useRouter();

  const [clearedField, setClearedField] = useState<"credits" | "coupon" | null>(
    null,
  );

  const form = useForm<BillingFormData>({
    resolver: zodResolver(billingFormSchema(t)),
    defaultValues: {
      credits: null,
      coupon: null,
    },
  });

  // Effect is necessary: Analytics tracking when component is displayed
  // Fires once on mount to track page view
  useEffect(() => {
    fireGTMEvent.viewBilling();
  }, []);

  const { setValue } = form;
  const credits = useWatch({
    control: form.control,
    name: "credits",
  });
  const coupon = useWatch({
    control: form.control,
    name: "coupon",
  });

  const handleFieldChange = useCallback(
    (field: "credits" | "coupon", value: number | string | undefined) => {
      if (field === "credits") {
        const numValue = value as number | undefined;
        setValue("credits", numValue);

        // Only clear coupon if we have a valid credit amount and coupon exists
        if (numValue && numValue > 0) {
          const currentCoupon = form.getValues("coupon");
          if (currentCoupon) {
            setValue("coupon", "");
            setClearedField("coupon");
          }
        }
      } else if (field === "coupon") {
        const strValue = String(value ?? "");
        setValue("coupon", strValue);

        // Only clear credits if we have a valid coupon and credits exist
        if (strValue.length > 0) {
          const currentCredits = form.getValues("credits");
          if (currentCredits && currentCredits > 0) {
            setValue("credits", undefined);
            setClearedField("credits");
          }
        }
      }
    },
    [setValue, form],
  );

  const handleSubmit = useCallback(
    async (data: BillingFormData) => {
      let result;
      if (data.coupon && data.coupon.trim().length > 0) {
        result = await claimFreeCreditsWithCoupon({
          organizationId: organization?.id ?? null,
          priceId: price.id,
          couponId: data.coupon.trim(),
        });
      } else if (data.credits && data.credits > 0) {
        result = await purchaseCredits({
          organizationId: organization?.id ?? null,
          priceId: price.id,
          credits: data.credits,
        });
      } else {
        toast.error(t("invalidInput"));
        return;
      }

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
          case BillingErrorCode.INVALID_CREDITS:
            toast.error(t("Errors.invalidCredits"));
            break;
          case BillingErrorCode.INVALID_COUPON:
            toast.error(t("Errors.invalidCoupon"));
            break;
          case BillingErrorCode.COUPON_NOT_FOUND:
            toast.error(t("Errors.couponNotFound"));
            break;
          case BillingErrorCode.COUPON_TYPE_ERROR:
            toast.error(t("Errors.couponTypeError"));
            break;
          case BillingErrorCode.COUPON_CURRENCY_ERROR:
            toast.error(t("Errors.couponCurrencyError"));
            break;
          case BillingErrorCode.PROMOTION_CODE_NOT_FOUND:
            toast.error(t("Errors.promotionCodeNotFound"));
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
    [router, t, price, organization],
  );

  const handleQuickAmount = useCallback(
    (amount: number) => {
      handleFieldChange("credits", amount);
    },
    [handleFieldChange],
  );

  const { isSubmitting } = form.formState;

  const FieldClearedIndicator = ({
    show,
    message,
  }: {
    show: boolean;
    message: string;
  }) =>
    show ? (
      <div className="text-muted-foreground mt-1 text-xs transition-opacity duration-200">
        {message}
      </div>
    ) : null;

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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[10, 25, 50, 100].map((amount) => (
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
                      max="10000"
                      disabled={isSubmitting}
                      {...field}
                      onChange={(e) => {
                        const { value } = e.target;
                        if (value === "") {
                          handleFieldChange("credits", undefined);
                        } else {
                          const numValue = Number(value);
                          if (Number.isFinite(numValue) && numValue >= 0) {
                            handleFieldChange("credits", numValue);
                          }
                        }
                      }}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FieldClearedIndicator
                    show={clearedField === "credits"}
                    message={t("creditsCleared")}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="coupon"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("couponLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder={t("couponPlaceholder")}
                      disabled={isSubmitting}
                      autoComplete="off"
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        handleFieldChange("coupon", value);
                      }}
                    />
                  </FormControl>
                  <FieldClearedIndicator
                    show={clearedField === "coupon"}
                    message={t("couponCleared")}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex items-center justify-between pt-6">
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                ((!credits || credits <= 0) &&
                  (!coupon || coupon.trim().length === 0))
              }
            >
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {organization ? t("topUpButtonOrganization") : t("topUpButton")}
            </Button>
            <p className="text-muted-foreground text-sm">
              {t("costPerCredit", {
                cost: formatter.number(price.amountPerCredit / 100, {
                  style: "currency",
                  currency: price.currency,
                }),
              })}
            </p>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
