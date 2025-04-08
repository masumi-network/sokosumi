"use client";

import { useTranslations } from "next-intl";
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
  costPerCreditUSD: number;
}

export default function BillingForm({ costPerCreditUSD }: BillingFormProps) {
  const t = useTranslations("App.Billing");
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
        <p className="text-muted-foreground text-sm">
          {t("costPerCredit", {
            cost: costPerCreditUSD.toFixed(2),
            currency: "USD",
          })}
        </p>
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
      <CardFooter>
        <Button
          onClick={() => handleTopUp(customAmount)}
          disabled={!customAmount || Number(customAmount) <= 0}
        >
          {t("topUpButton")}
        </Button>
      </CardFooter>
    </Card>
  );
}
