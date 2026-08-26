"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setSokoBotFollowBoardAction } from "@/lib/actions/soko-bot/action";

/** Whether the bot follows every open Task on the board, not only its own. */
export function FollowBoardToggle({ initial }: { initial: boolean }) {
  const t = useTranslations("App.SokoBot.Settings");
  const id = useId();
  const [enabled, setEnabled] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await setSokoBotFollowBoardAction({ enabled: next });
      if (!result.ok) {
        setEnabled(!next);
        toast.error(result.error.message ?? t("followBoardError"));
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {t("followBoardTitle")}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t("followBoardDescription")}
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
