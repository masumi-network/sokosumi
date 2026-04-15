import { BalanceStripeCustomerRow } from "@/components/billing/balance-stripe-customer-row";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BalanceSectionProps {
  creditsLabel: string;
  description: string;
  stripeCustomerId?: null | string;
  stripeCustomerLabel?: string;
  title: string;
}

export function BalanceSection({
  creditsLabel,
  description,
  stripeCustomerId,
  stripeCustomerLabel,
  title,
}: BalanceSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stripeCustomerId && stripeCustomerLabel ? (
          <BalanceStripeCustomerRow
            key={stripeCustomerId}
            label={stripeCustomerLabel}
            stripeCustomerId={stripeCustomerId}
          />
        ) : null}
        <p className="text-2xl font-semibold">{creditsLabel}</p>
      </CardContent>
    </Card>
  );
}
