import { CheckCheck } from "lucide-react";
import type { ReactNode } from "react";

interface ChatUnreadViewHeaderProps {
  title: string;
  /** The view's bulk action, on the heading row. */
  action?: ReactNode;
}

/**
 * The heading row of the Threads and All unreads views (SOK-1159), in the
 * Notification Center page's shape: title first, the bulk action on the same
 * row so it cannot collapse under the pointer when the last row drains.
 */
export function ChatUnreadViewHeader({
  title,
  action,
}: ChatUnreadViewHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {action}
    </div>
  );
}

interface ChatCaughtUpProps {
  title: string;
  description: string;
}

/**
 * What both views say once there is nothing left: the list drained, which is
 * the point of them, so it reads as done rather than as missing.
 */
export function ChatCaughtUp({ title, description }: ChatCaughtUpProps) {
  return (
    <div
      data-testid="chat-caught-up"
      className="flex flex-col items-center gap-2 px-4 py-12 text-center"
    >
      <span className="bg-primary-quaternary text-primary-variant grid size-10 place-items-center rounded-full">
        <CheckCheck className="size-5" aria-hidden />
      </span>
      <p className="font-semibold">{title}</p>
      <p className="text-muted-foreground max-w-xs text-sm text-pretty">
        {description}
      </p>
    </div>
  );
}
