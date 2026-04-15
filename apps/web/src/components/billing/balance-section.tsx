import { BalanceStripeCustomerRow } from "@/components/billing/balance-stripe-customer-row";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  const stripeRow =
    stripeCustomerId != null && stripeCustomerLabel != null
      ? { ariaLabel: stripeCustomerLabel, id: stripeCustomerId }
      : null;

  return (
    <Card>
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
        <div className="col-start-1 row-span-2 flex min-w-0 flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <p
          className={cn(
            "col-start-2 justify-self-end text-right text-3xl font-semibold tracking-tight tabular-nums",
            stripeRow
              ? "row-start-1 self-start"
              : "row-span-2 row-start-1 self-start",
          )}
        >
          {creditsLabel}
        </p>
        {stripeRow ? (
          <div className="col-start-2 row-start-2 justify-self-end self-start">
            <BalanceStripeCustomerRow
              key={stripeRow.id}
              ariaLabel={stripeRow.ariaLabel}
              stripeCustomerId={stripeRow.id}
            />
          </div>
        ) : null}
      </CardHeader>
    </Card>
  );
}
