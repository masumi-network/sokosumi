"use client";

import { Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { updateSokoBotProactiveAction } from "@/lib/actions/soko-bot/action";

/**
 * Pauses or resumes the work a bot starts on its own. A paused bot still
 * answers when someone messages it.
 */
export function PauseSokoBotButton({
  botId,
  name,
  paused,
}: {
  /** `null` for the viewer's own bot. */
  botId: string | null;
  name: string;
  paused: boolean;
}) {
  const t = useTranslations("App.SokoBots");
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      loading={pending}
      aria-label={t(paused ? "resumeName" : "pauseName", { name })}
      onClick={() =>
        startTransition(async () => {
          const result = await updateSokoBotProactiveAction({
            input: { paused: !paused },
            botId: botId ?? undefined,
          });
          if (!result.ok) {
            toast.error(t(paused ? "resumeError" : "pauseError"));
            return;
          }
          toast.success(t(paused ? "resumed" : "pausedToast", { name }));
        })
      }
    >
      {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
      {t(paused ? "resume" : "pause")}
    </Button>
  );
}
