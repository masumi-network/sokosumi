import type { ReactNode } from "react";

import { BalanceStripeCustomerRow } from "@/components/billing/balance-stripe-customer-row";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface BalanceSectionProps {
  billingPortal?: ReactNode;
  creditsLabel: string;
  description: string;
  stripeCustomerId?: null | string;
  stripeCustomerLabel?: string;
  title: string;
}

export function BalanceSection({
  billingPortal,
  creditsLabel,
  description,
  stripeCustomerId,
  stripeCustomerLabel,
  title,
}: BalanceSectionProps) {
  const stripeRow =
    stripeCustomerId != null && stripeCustomerLabel != null
      ? { ariaLabel: stripeCustomerLabel, id: stripeCustomerId }
      : null;

  return (
    <Card>
      <CardHeader className="grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-y-1.5">
        <div
          className={cn(
            "col-start-1 row-span-1 flex min-w-0 flex-col gap-1",
            billingPortal ? "sm:row-span-3" : "sm:row-span-2",
          )}
        >
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <p
          className={cn(
            "col-start-1 justify-self-start text-left text-2xl font-semibold tracking-tight tabular-nums sm:col-start-2 sm:justify-self-end sm:text-right sm:text-3xl",
            stripeRow
              ? "self-start sm:row-start-1"
              : "self-start sm:row-span-2 sm:row-start-1",
          )}
        >
          {creditsLabel}
        </p>
        {stripeRow ? (
          <div className="col-start-1 max-w-full justify-self-start self-start sm:col-start-2 sm:row-start-2 sm:justify-self-end">
            <BalanceStripeCustomerRow
              key={stripeRow.id}
              ariaLabel={stripeRow.ariaLabel}
              stripeCustomerId={stripeRow.id}
            />
          </div>
        ) : null}
      </CardHeader>
      {billingPortal ? (
        <CardContent>
          <Separator />
          <div className="pt-2">{billingPortal}</div>
        </CardContent>
      ) : null}
    </Card>
  );
}
