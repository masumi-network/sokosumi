"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

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

interface BillingFormProps {
  amountPerCredit: number;
  currency: string;
}

export default function BillingForm({
  amountPerCredit,
  currency,
}: BillingFormProps) {
  const t = useTranslations("App.Billing");
  const format = useFormatter();
  const [customAmount, setCustomAmount] = useState("");

  const handleTopUp = (amount: number | string) => {
    console.log("Topping up credits:", amount);
    // TODO: Implement actual top-up logic
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
              onClick={() => setCustomAmount(String(amount))}
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
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            min="1"
          />
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <Button
          onClick={() => handleTopUp(customAmount)}
          disabled={!customAmount || Number(customAmount) <= 0}
        >
          {t("topUpButton")}
        </Button>
        <p className="text-muted-foreground text-sm">
          {t("costPerCredit", {
            cost: format.number(amountPerCredit, {
              style: "currency",
              currency,
            }),
          })}
        </p>
      </CardFooter>
    </Card>
  );
}
