"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { startSokoBotTurnAction } from "@/lib/actions/soko-bot/action";
import type { SokoBotStatus } from "@/lib/clients/generated/core";
import { SOKO_BOT_BUSY_ERROR_CODE } from "@/lib/soko-bot/constants";

interface TurnComposerProps {
  botStatus: SokoBotStatus;
}

const MAX_MESSAGE_LENGTH = 8000;

/**
 * Sends one chat turn. The `clientTurnId` is bound to the trimmed draft: a
 * failed or lost-response submit keeps the same id so a retry is idempotent
 * on Core (duplicate → existing turn), while a materially changed draft gets
 * a fresh id. Cleared only after acknowledged success.
 */
interface PendingSubmission {
  message: string;
  clientTurnId: string;
}
export function TurnComposer({ botStatus }: TurnComposerProps) {
  const t = useTranslations("App.SokoBot.Composer");
  const router = useRouter();
  const textareaId = useId();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  // Survives failed submits; a ref (not state) so a lost response cannot race
  // a re-render into minting a second id for the same draft.
  const pendingRef = useRef<PendingSubmission | null>(null);
  const paused = botStatus === "PAUSED";
  const running = botStatus === "RUNNING";
  const blocked = paused || running;

  function submissionFor(trimmed: string): PendingSubmission {
    const current = pendingRef.current;
    if (current && current.message === trimmed) return current;
    const next = { message: trimmed, clientTurnId: crypto.randomUUID() };
    pendingRef.current = next;
    return next;
  }

  function submit() {
    const trimmed = message.trim();
    if (!trimmed || isPending || blocked) return;
    const submission = submissionFor(trimmed);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof startSokoBotTurnAction>>;
      try {
        result = await startSokoBotTurnAction({
          input: {
            clientTurnId: submission.clientTurnId,
            message: submission.message,
          },
        });
      } catch {
        // Lost response / transport failure: keep the same submission so the
        // next click re-sends the identical clientTurnId.
        toast.error(t("error"));
        return;
      }
      if (!result.ok) {
        const busy = result.error.code === SOKO_BOT_BUSY_ERROR_CODE;
        toast.error(busy ? t("busy") : (result.error.message ?? t("error")));
        return;
      }
      pendingRef.current = null;
      setMessage("");
      router.refresh();
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="bg-background space-y-2 rounded-md border p-3"
    >
      <Label htmlFor={textareaId} className="sr-only">
        {t("label")}
      </Label>
      <Textarea
        id={textareaId}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          paused
            ? t("pausedPlaceholder")
            : running
              ? t("runningPlaceholder")
              : t("placeholder")
        }
        maxLength={MAX_MESSAGE_LENGTH}
        rows={3}
        disabled={blocked || isPending}
        className="min-h-20 resize-y"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {paused ? t("pausedHint") : running ? t("runningHint") : t("hint")}
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={blocked || isPending || message.trim().length === 0}
        >
          {isPending ? t("sending") : t("send")}
        </Button>
      </div>
    </form>
  );
}
