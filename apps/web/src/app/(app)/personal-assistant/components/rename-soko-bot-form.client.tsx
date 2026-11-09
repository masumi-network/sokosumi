"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameSokoBotAction } from "@/lib/actions/soko-bot/action";
import { useSokoBotTargetId } from "./soko-bot-target";

/** The bot's name, saved where everyone sees it: chat, Tasks, the sidebar. */
export function RenameSokoBotForm({ initial }: { initial: string }) {
  const t = useTranslations("App.SokoBot.Settings");
  const id = useId();
  const botId = useSokoBotTargetId();
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial);
  const [blank, setBlank] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = name.trim();
    if (!next) {
      setBlank(true);
      return;
    }
    startTransition(async () => {
      const result = await renameSokoBotAction({ name: next, botId });
      if (!result.ok) {
        toast.error(result.error.message ?? t("renameError"));
        return;
      }
      setName(next);
      setSaved(next);
      toast.success(t("renamed"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5" noValidate>
      <Label htmlFor={id} className="text-sm font-medium">
        {t("nameTitle")}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setBlank(false);
          }}
          maxLength={80}
          autoComplete="off"
          aria-invalid={blank || undefined}
          aria-describedby={`${id}-hint`}
        />
        <Button
          type="submit"
          loading={isPending}
          disabled={name.trim() === saved}
        >
          {t("rename")}
        </Button>
      </div>
      <p
        id={`${id}-hint`}
        className={
          blank ? "text-destructive text-xs" : "text-muted-foreground text-xs"
        }
      >
        {blank ? t("nameRequired") : t("nameDescription")}
      </p>
    </form>
  );
}
