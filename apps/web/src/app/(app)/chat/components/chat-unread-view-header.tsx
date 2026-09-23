import { CheckCheck } from "lucide-react";

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
}

/**
 * What the Threads flyout says with nothing unread (SOK-1159): draining is
 * the point of it, so it reads as done rather than as missing.
 */
export function ChatCaughtUp({ title, description }: ChatCaughtUpProps) {
  return (
    <div
      data-testid="chat-caught-up"
      className="flex flex-col items-center gap-1.5 px-4 py-6 text-center"
    >
      <span className="bg-primary-quaternary text-primary-variant grid size-8 place-items-center rounded-full">
        <CheckCheck className="size-4" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground max-w-xs text-sm text-pretty">
          {description}
        </p>
      ) : null}
    </div>
  );
}
