"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSokoBotScheduleAction } from "@/lib/actions/soko-bot/action";

const DEFAULT_CRON = "0 9 * * 1-5";

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Minimal create form: name, cron, timezone, prompt. Collapsed until opened. */
export function ScheduleForm() {
  const t = useTranslations("App.SokoBot.Schedules.Form");
  const router = useRouter();
  const ids = {
    name: useId(),
    cron: useId(),
    timezone: useId(),
    prompt: useId(),
  };
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cronExpression, setCronExpression] = useState(DEFAULT_CRON);
  const [timezone, setTimezone] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setTimezone((current) => current || browserTimezone());
          setOpen(true);
        }}
      >
        {t("open")}
      </Button>
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createSokoBotScheduleAction({
        input: {
          name: name.trim(),
          cronExpression: cronExpression.trim(),
          timezone: timezone.trim(),
          prompt: prompt.trim(),
        },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      toast.success(t("created"));
      setName("");
      setPrompt("");
      setCronExpression(DEFAULT_CRON);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={ids.name}>{t("name")}</Label>
        <Input
          id={ids.name}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={ids.cron}>{t("cron")}</Label>
          <Input
            id={ids.cron}
            value={cronExpression}
            onChange={(event) => setCronExpression(event.target.value)}
            className="font-mono"
            maxLength={64}
            required
            aria-describedby={`${ids.cron}-hint`}
          />
          <p id={`${ids.cron}-hint`} className="text-muted-foreground text-xs">
            {t("cronHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.timezone}>{t("timezone")}</Label>
          <Input
            id={ids.timezone}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            maxLength={64}
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={ids.prompt}>{t("prompt")}</Label>
        <Textarea
          id={ids.prompt}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          maxLength={4000}
          required
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={isPending}
        >
          {t("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
