import { CheckCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ChatUnreadViewHeaderProps {
  title: string;
}

/** The Threads view's heading (SOK-1159), in the Notification Center's size. */
export function ChatUnreadViewHeader({ title }: ChatUnreadViewHeaderProps) {
  return <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>;
}

interface ChatCaughtUpProps {
  title: string;
  description?: string;
  /** A way onward, drawn under the words. */
  action?: ReactNode;
  /** `page` for the Threads view; `sidebar` for the unread filter's list. */
  size?: "page" | "sidebar";
}

/**
 * What a drained unread list says: the Threads view, and the sidebar under
 * the All unreads filter (SOK-1159). Draining is the point of both, so it
 * reads as done rather than as missing, in the same tinted mark.
 */
export function ChatCaughtUp({
  title,
  description,
  action,
  size = "page",
}: ChatCaughtUpProps) {
  const sidebar = size === "sidebar";
  return (
    <div
      data-testid="chat-caught-up"
      className={cn(
        "flex flex-col items-center text-center",
        sidebar ? "gap-1.5 px-4 py-6" : "gap-2 px-4 py-12",
      )}
    >
      <span
        className={cn(
          "bg-primary-quaternary text-primary-variant grid place-items-center rounded-full",
          sidebar ? "size-8" : "size-10",
        )}
      >
        <CheckCheck className={sidebar ? "size-4" : "size-5"} aria-hidden />
      </span>
      <p className={sidebar ? "text-sm font-medium" : "font-semibold"}>
        {title}
      </p>
      {description ? (
        <p className="text-muted-foreground max-w-xs text-sm text-pretty">
          {description}
        </p>
      ) : null}
      {action}
    </div>
  );
}
