"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
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
import { purchaseCredits } from "@/lib/actions";

const billingFormSchema = z.object({
  credits: z.number().min(1, "Amount must be at least 1 credit"),
  coupon: z.string().optional(),
});

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

  const form = useForm<BillingFormData>({
    resolver: zodResolver(billingFormSchema),
    defaultValues: {
      credits: 0,
      coupon: "",
    },
  });

  const { watch, setValue } = form;
  const credits = watch("credits");

  const onSubmit = async (data: BillingFormData) => {
    try {
      const result = await purchaseCredits(priceId, data.credits, data.coupon);

      if (result.success && result.url) {
        window.location.href = result.url;
      } else {
        toast.error(result.error ?? "Failed to create checkout");
      }
    } catch (error) {
      console.error("Failed to create checkout session:", error);
      toast.error("An unexpected error occurred");
    }
  };

  const handleQuickAmount = (amount: number) => {
    setValue("credits", amount);
  };

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
                      disabled={form.formState.isSubmitting}
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      value={field.value || ""}
                    />
                  </FormControl>
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
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex items-center justify-between pt-6">
            <Button
              type="submit"
              disabled={!credits || credits <= 0 || form.formState.isSubmitting}
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
