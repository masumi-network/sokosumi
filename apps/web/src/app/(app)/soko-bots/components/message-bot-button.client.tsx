"use client";

import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { ensureOrchestratorDirectRoomAction } from "@/app/chat/actions";
import { Button } from "@/components/ui/button";

/** Opens (or creates) the direct room with the signed-in user's personal assistant. */
export function MessageBotButton({
  sokoBotId,
  label,
  errorLabel,
  variant = "link",
}: {
  sokoBotId: string;
  label: string;
  errorLabel: string;
  variant?: "link" | "button";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const open = () =>
    startTransition(async () => {
      const result = await ensureOrchestratorDirectRoomAction(sokoBotId);
      if (!result.ok || !result.value) {
        toast.error(errorLabel);
        return;
      }
      router.push(`/chat/rooms/${encodeURIComponent(result.value.id)}`);
    });
  if (variant === "button") {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={open}
      >
        <MessageSquare aria-hidden className="size-3.5" />
        {label}
      </Button>
    );
  }
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={open}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs disabled:opacity-60"
    >
      <MessageSquare aria-hidden className="size-3" />
      {label}
    </button>
  );
}
