import type { ChatRoomPresence } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface PresenceDotProps {
  presence: ChatRoomPresence;
  label: string;
  className?: string;
}

export function PresenceDot({ presence, label, className }: PresenceDotProps) {
  return (
    <span
      aria-label={label}
      className={cn(
        "border-background block size-2.5 rounded-full border-2",
        presence === "online" && "bg-semantic-success",
        presence === "afk" && "bg-semantic-warning",
        presence === "offline" && "bg-muted-foreground/55",
        className,
      )}
      title={label}
    />
  );
}
