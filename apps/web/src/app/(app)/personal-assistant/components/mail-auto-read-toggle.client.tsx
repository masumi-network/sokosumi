"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateSokoBotProactiveAction } from "@/lib/actions/soko-bot/action";
import { useSokoBotTargetId } from "./soko-bot-target";

/** Whether the bot marks unimportant mail read after triage. */
export function MailAutoReadToggle({ initial }: { initial: boolean }) {
  const t = useTranslations("App.SokoBot.Settings");
  const id = useId();
  const botId = useSokoBotTargetId();
  const [enabled, setEnabled] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await updateSokoBotProactiveAction({
        input: { mailAutoRead: next },
        botId,
      });
      if (!result.ok) {
        setEnabled(!next);
        toast.error(result.error.message ?? t("mailAutoReadError"));
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {t("mailAutoReadTitle")}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t("mailAutoReadDescription")}
        </p>
      </div>
      <Switch
        id={id}
        checked={enabled}
        disabled={isPending}
        onCheckedChange={handleChange}
      />
    </div>
  );
}
