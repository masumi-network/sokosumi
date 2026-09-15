import { Badge } from "@/components/ui/badge";
import type { SocialPostStatus } from "@/lib/clients/generated/core/types.gen";

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>;

interface StatusBadgeStyle {
  variant: BadgeVariant;
  /** Semantic tone on top of the base variant; PUBLISHED and MISSED need colors the variants lack. */
  className?: string;
}

const STATUS_BADGE_STYLES: Record<SocialPostStatus, StatusBadgeStyle> = {
  DRAFT: { variant: "outline" },
  SCHEDULED: { variant: "secondary" },
  PUBLISHING: { variant: "secondary" },
  PUBLISHED: {
    variant: "default",
    className: "bg-semantic-success text-semantic-success-foreground",
  },
  FAILED: { variant: "destructive" },
  MISSED: {
    variant: "outline",
    className: "border-semantic-warning text-semantic-warning",
  },
  CANCELED: { variant: "outline" },
};

interface SocialPostStatusBadgeProps {
  label: string;
  status: SocialPostStatus;
}

export function SocialPostStatusBadge({
  label,
  status,
}: SocialPostStatusBadgeProps) {
  const style = STATUS_BADGE_STYLES[status];
  return (
    <Badge
      variant={style.variant}
      className={style.className}
      data-testid={`social-post-status-${status}`}
    >
      {label}
    </Badge>
  );
}
