"use client";

import { Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { purchaseCredits } from "@/lib/actions";

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
  const [customAmount, setCustomAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTopUp = async (credits: number | null) => {
    if (!credits || credits <= 0) {
      return;
    }
    setLoading(true);
    try {
      const result = await purchaseCredits(credits, priceId);

      if (result.success && result.url) {
        window.location.href = result.url;
      } else {
        toast.error(result.error ?? "Failed to create checkout");
      }
    } catch (error) {
      console.error("Failed to create checkout session:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("topUpTitle")}</CardTitle>
        <CardDescription>{t("topUpDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[10, 25, 50, 100].map((amount) => (
            <Button
              key={amount}
              variant="outline"
              onClick={() => setCustomAmount(amount)}
              disabled={loading}
            >
              {t("creditAmount", { count: amount })}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="custom-amount">{t("amountToTopUpLabel")}</Label>
          <Input
            id="custom-amount"
            type="number"
            placeholder={t("customAmountPlaceholder")}
            value={customAmount ?? ""}
            onChange={(e) => setCustomAmount(Number(e.target.value))}
            min="1"
            disabled={loading}
          />
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <Button
          onClick={() => handleTopUp(customAmount)}
          disabled={!customAmount || Number(customAmount) <= 0 || loading}
        >
          {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
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
    </Card>
  );
}
