"use client";

import { CopyableValue } from "@/components/copyable-value";

export interface BalanceStripeCustomerRowProps {
  /** Shown only to assistive tech; there is no visible label. */
  ariaLabel: string;
  stripeCustomerId: string;
}

export function BalanceStripeCustomerRow({
  ariaLabel,
  stripeCustomerId,
}: BalanceStripeCustomerRowProps) {
  return (
    <div className="inline-flex max-w-full min-w-0 items-center justify-end text-right">
      <span className="sr-only">{ariaLabel}: </span>
      <CopyableValue
        copiedFeedback
        presentation="inline-code"
        value={stripeCustomerId}
        buttonClassName="size-7"
        codeClassName="text-muted-foreground text-xs"
        containerClassName="min-w-0 justify-end gap-1"
      />
    </div>
  );
}
