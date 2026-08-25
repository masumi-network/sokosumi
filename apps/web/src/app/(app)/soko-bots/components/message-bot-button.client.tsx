"use client";

import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { ensureCoworkerDirectRoomAction } from "@/app/chat/actions";

/** Opens (or creates) the direct room with a Soko Bot's chat coworker. */
export function MessageBotButton({
  coworkerId,
  label,
  errorLabel,
}: {
  coworkerId: string;
  label: string;
  errorLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await ensureCoworkerDirectRoomAction(coworkerId);
          if (!result.ok || !result.value) {
            toast.error(errorLabel);
            return;
          }
          router.push(`/chat/rooms/${encodeURIComponent(result.value.id)}`);
        })
      }
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs disabled:opacity-60"
    >
      <MessageSquare aria-hidden className="size-3" />
      {label}
    </button>
  );
}
