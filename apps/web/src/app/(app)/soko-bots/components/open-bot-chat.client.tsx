"use client";

import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useTransition } from "react";
import { toast } from "sonner";

import { ensureSokoBotDirectRoomAction } from "@/app/chat/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Opens (or creates) the direct room with a Soko Bot: yours or a teammate's. */
function useOpenBotChat(sokoBotId: string, errorLabel: string) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const open = () =>
    startTransition(async () => {
      const result = await ensureSokoBotDirectRoomAction(sokoBotId);
      if (!result.ok || !result.value) {
        toast.error(errorLabel);
        return;
      }
      router.push(`/chat/rooms/${encodeURIComponent(result.value.id)}`);
    });
  return { open, isPending };
}

export function ChatWithBotButton({
  sokoBotId,
  label,
  errorLabel,
  className,
}: {
  sokoBotId: string;
  label: string;
  errorLabel: string;
  className?: string;
}) {
  const { open, isPending } = useOpenBotChat(sokoBotId, errorLabel);
  return (
    <Button
      type="button"
      disabled={isPending}
      onClick={open}
      className={className}
    >
      <MessageSquare aria-hidden className="size-4" />
      {label}
    </Button>
  );
}

/** A whole tile that opens the bot's chat; the tile's content is its label. */
export function ChatWithBotTile({
  sokoBotId,
  label,
  errorLabel,
  className,
  children,
}: {
  sokoBotId: string;
  label: string;
  errorLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const { open, isPending } = useOpenBotChat(sokoBotId, errorLabel);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={isPending}
      onClick={open}
      className={cn(
        "press focus-visible:ring-ring text-left outline-none focus-visible:ring-2 disabled:opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}
