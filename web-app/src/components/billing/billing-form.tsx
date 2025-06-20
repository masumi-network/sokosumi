"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { getFreeCreditsWithCoupon, purchaseCredits } from "@/lib/actions";

const billingFormSchema = z
  .object({
    credits: z.number().optional(),
    coupon: z.string().optional(),
  })
  .refine(
    (data) => {
      const hasValidCredits = data.credits != null && data.credits > 0;
      const hasValidCoupon =
        data.coupon != null && data.coupon.trim().length > 0;
      return hasValidCredits || hasValidCoupon;
    },
    (data) => {
      // Show error on the field that makes more sense contextually
      const hasCreditsAttempt = data.credits != null;
      const hasCouponAttempt =
        data.coupon != null && data.coupon.trim().length > 0;

      return {
        message: "Please enter either a credit amount or a coupon code",
        path: hasCreditsAttempt && !hasCouponAttempt ? ["credits"] : ["coupon"],
      };
    },
  );

type BillingFormData = z.infer<typeof billingFormSchema>;

interface BillingFormProps {
  priceId: string;
  amountPerCredit: number;
  currency: string;
}

export default function BillingForm({
  priceId,
  amountPerCredit,
  currency,
}: BillingFormProps) {
  const t = useTranslations("App.Billing");
  const formatter = useFormatter();
  const [clearedField, setClearedField] = useState<"credits" | "coupon" | null>(
    null,
  );

  const form = useForm<BillingFormData>({
    resolver: zodResolver(billingFormSchema),
    defaultValues: {
      credits: undefined,
      coupon: undefined,
    },
  });

  const { watch, setValue } = form;
  const credits = watch("credits");
  const coupon = watch("coupon");

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

  const onSubmit = async (data: BillingFormData) => {
    try {
      let result;

      // If coupon is provided, use coupon redemption flow
      if (data.coupon && data.coupon.trim().length > 0) {
        result = await getFreeCreditsWithCoupon(priceId, data.coupon.trim());
      }
      // Otherwise, use credit purchase flow
      else if (data.credits && data.credits > 0) {
        result = await purchaseCredits(priceId, data.credits);
      } else {
        toast.error(t("couponOrCreditsError"));
        return;
      }

      if (result.success && result.url) {
        window.location.href = result.url;
      } else {
        toast.error(result.error ?? "Failed to create checkout");
      }
    } catch (error) {
      console.error("Failed to create checkout session:", error);
      toast.error(t("Error.title"));
    }
  };

  const handleQuickAmount = useCallback(
    (amount: number) => {
      handleFieldChange("credits", amount);
    },
    [handleFieldChange],
  );

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
        <CardDescription>{t("topUpDescription")}</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[10, 25, 50, 100].map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant="outline"
                  onClick={() => handleQuickAmount(amount)}
                  disabled={form.formState.isSubmitting}
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
                      disabled={form.formState.isSubmitting}
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
                      disabled={form.formState.isSubmitting}
                      autoComplete="off"
                      {...field}
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
                form.formState.isSubmitting ||
                ((!credits || credits <= 0) &&
                  (!coupon || coupon.trim().length === 0))
              }
            >
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              {t("topUpButton")}
            </Button>
            <p className="text-muted-foreground text-sm">
              {t("costPerCredit", {
                cost: formatter.number(amountPerCredit / 100, {
                  style: "currency",
                  currency,
                }),
              })}
            </p>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
