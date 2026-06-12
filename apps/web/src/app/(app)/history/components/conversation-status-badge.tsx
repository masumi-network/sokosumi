import { cn } from "@/lib/utils";

type ConversationHistoryStatus = "active" | "archived";

interface StatusPillStyle {
  bg: string;
  text: string;
  dot: string;
}

const STATUS_PILL_STYLES: Record<ConversationHistoryStatus, StatusPillStyle> = {
  active: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  archived: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

interface ConversationStatusBadgeProps {
  status: ConversationHistoryStatus;
  label: string;
  className?: string;
}

export function ConversationStatusBadge({
  status,
  label,
  className,
}: ConversationStatusBadgeProps) {
  const styles = STATUS_PILL_STYLES[status];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium",
        styles.bg,
        styles.text,
        className,
      )}
    >
      <span>{label}</span>
    </span>
  );
}
