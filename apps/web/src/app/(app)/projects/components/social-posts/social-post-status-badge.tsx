import { Badge } from "@/components/ui/badge";
import type { SocialPostStatus } from "@/lib/clients/generated/core/types.gen";

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>;

const STATUS_BADGE_VARIANTS: Record<SocialPostStatus, BadgeVariant> = {
  DRAFT: "outline",
  SCHEDULED: "secondary",
  PUBLISHING: "secondary",
  PUBLISHED: "default",
  FAILED: "destructive",
  MISSED: "destructive",
  CANCELED: "outline",
};

interface SocialPostStatusBadgeProps {
  label: string;
  status: SocialPostStatus;
}

export function SocialPostStatusBadge({
  label,
  status,
}: SocialPostStatusBadgeProps) {
  return (
    <Badge
      variant={STATUS_BADGE_VARIANTS[status]}
      data-testid={`social-post-status-${status}`}
    >
      {label}
    </Badge>
  );
}
