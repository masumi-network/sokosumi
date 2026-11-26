"use client";

import { Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { updateSokoBotProactiveAction } from "@/lib/actions/soko-bot/action";

interface PauseTarget {
  /** `null` for the viewer's own bot. */
  botId: string | null;
  name: string;
  paused: boolean;
}

/**
 * Pauses or resumes the work a bot starts on its own. A paused bot still
 * answers when someone messages it.
 */
export function usePauseSokoBot({ botId, name, paused }: PauseTarget) {
  const t = useTranslations("App.SokoBots");
  const [pending, startTransition] = useTransition();
  const toggle = () =>
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
    });
  return { toggle, pending };
}

export function PauseSokoBotButton(props: PauseTarget) {
  const t = useTranslations("App.SokoBots");
  const { toggle, pending } = usePauseSokoBot(props);
  const { name, paused } = props;

  return (
    <Button
      type="button"
      size="sm"
      loading={pending}
      aria-label={t(paused ? "resumeName" : "pauseName", { name })}
      onClick={toggle}
    >
      {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
      {t(paused ? "resume" : "pause")}
    </Button>
  );
}
