import { ExternalLink, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buildBillingPortalRedirectPath } from "@/lib/billing/billing-portal-redirect";

interface BalanceBillingPortalLinkProps {
  description: string;
  label: string;
  organizationId?: string | null;
  returnPath: string;
}

export function BalanceBillingPortalLink({
  description,
  label,
  organizationId = null,
  returnPath,
}: BalanceBillingPortalLinkProps) {
  const href = buildBillingPortalRedirectPath({ returnPath, organizationId });

  return (
    <Button
      asChild
      variant="ghost"
      className="group h-auto w-full justify-start gap-3 rounded-lg p-3 text-left hover:bg-accent/60 has-[>svg]:px-3"
    >
      <a href={href} target="_blank" rel="noopener noreferrer">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ReceiptText className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-semibold text-primary">{label}</span>
          <span className="text-muted-foreground text-sm leading-snug whitespace-normal">
            {description}
          </span>
        </span>
        <ExternalLink className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </a>
    </Button>
  );
}
