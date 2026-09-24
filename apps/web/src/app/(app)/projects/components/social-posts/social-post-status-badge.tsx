import { Badge } from "@/components/ui/badge";
import { MARKER_ICONS } from "@/components/ui/status-marker";
import type { SocialPostStatus } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

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

const STATUS_ICONS = {
  DRAFT: MARKER_ICONS.draft,
  SCHEDULED: MARKER_ICONS.queued,
  PUBLISHING: MARKER_ICONS.running,
  PUBLISHED: MARKER_ICONS.completed,
  FAILED: MARKER_ICONS.failed,
  MISSED: MARKER_ICONS.warning,
  CANCELED: MARKER_ICONS.canceled,
} satisfies Record<SocialPostStatus, typeof MARKER_ICONS.queued>;

interface SocialPostStatusBadgeProps {
  label: string;
  status: SocialPostStatus;
  showLabel?: boolean;
}

export function SocialPostStatusBadge({
  label,
  status,
  showLabel = true,
}: SocialPostStatusBadgeProps) {
  const style = STATUS_BADGE_STYLES[status];
  const Icon = STATUS_ICONS[status];
  return (
    <Badge
      variant={style.variant}
      className={cn(
        style.className,
        !showLabel && "size-5 rounded-sm p-0 [&>svg]:size-3.5",
      )}
      role={showLabel ? undefined : "img"}
      aria-label={showLabel ? undefined : label}
      title={showLabel ? undefined : label}
      data-testid={`social-post-status-${status}`}
    >
      {showLabel ? (
        label
      ) : (
        <Icon
          aria-hidden
          strokeWidth={2.25}
          className={cn(
            status === "PUBLISHING" &&
              "animate-spin motion-reduce:animate-none",
          )}
        />
      )}
    </Badge>
  );
}
