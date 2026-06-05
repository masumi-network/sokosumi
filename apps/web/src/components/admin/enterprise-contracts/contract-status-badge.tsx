import { Badge } from "@/components/ui/badge";
import type { EnterpriseContractStatus } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<EnterpriseContractStatus, string> = {
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  canceled: "Canceled",
};

const STATUS_VARIANTS: Record<
  EnterpriseContractStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  active: "default",
  completed: "secondary",
  canceled: "destructive",
};

interface ContractStatusBadgeProps {
  status: EnterpriseContractStatus;
  className?: string;
}

export function ContractStatusBadge({
  status,
  className,
}: ContractStatusBadgeProps) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} className={cn(className)}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
