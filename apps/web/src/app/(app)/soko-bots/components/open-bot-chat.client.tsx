"use client";

import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { ensureSokoBotDirectRoomAction } from "@/app/chat/actions";
import { Button } from "@/components/ui/button";

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
  ariaLabel,
  errorLabel,
  size,
  className,
}: {
  sokoBotId: string;
  label: string;
  /** When the visible label alone does not say which bot. */
  ariaLabel?: string;
  errorLabel: string;
  size?: "default" | "sm";
  className?: string;
}) {
  const { open, isPending } = useOpenBotChat(sokoBotId, errorLabel);
  return (
    <Button
      type="button"
      size={size}
      aria-label={ariaLabel}
      disabled={isPending}
      onClick={open}
      className={className}
    >
      <MessageSquare aria-hidden className="size-4" />
      {label}
    </Button>
  );
}
