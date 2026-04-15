"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { MiddleTruncate } from "@/components/middle-truncate";
import { Button } from "@/components/ui/button";

export interface BalanceStripeCustomerRowProps {
  label: string;
  stripeCustomerId: string;
}

export function BalanceStripeCustomerRow({
  label,
  stripeCustomerId,
}: BalanceStripeCustomerRowProps) {
  const t = useTranslations("Components.HashValue");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(stripeCustomerId);
      toast.success(t("copySuccess"));
    } catch {
      toast.error(t("copyError"));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm">
      <span className="shrink-0">{label}</span>
      <div className="flex min-w-0 max-w-full flex-1 items-center gap-1">
        <MiddleTruncate
          className="min-w-0 font-mono text-xs"
          text={stripeCustomerId}
        />
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={() => void handleCopy()}
          className="text-muted-foreground shrink-0"
          title={t("copy")}
          aria-label={t("copy")}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}
