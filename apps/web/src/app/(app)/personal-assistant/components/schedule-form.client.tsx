"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { TaskScheduleWhen } from "@/app/tasks/components/task-schedule-when";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSokoBotScheduleAction } from "@/lib/actions/soko-bot/action";
import {
  type ScheduleRepeat,
  type ScheduleWhen,
  selectionToWhen,
  upcomingRuns,
} from "@/lib/schedules/schedule-when";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import { sokoBotScheduleCron } from "@/lib/soko-bot/schedule-cron";
import { isValidCronExpression } from "@/lib/utils/task-schedule";
import { SCHEDULE_FORM_FOCUS_ID } from "./schedule-form-focus";
import { useSokoBotTargetId } from "./soko-bot-target";

const DEFAULT_CRON = "0 9 * * 1-5";

/** Core runs a bot schedule forever on one cron: no interval, no end. */
const REPEATS: readonly ScheduleRepeat[] = [
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "custom",
];

/** Collapsed until opened; each opening starts fresh in the bot's timezone. */
export function ScheduleForm({ timezone }: { timezone?: string }) {
  const t = useTranslations("App.SokoBot.Schedules.Form");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  // The form replaces the button that held focus, and the button replaces the
  // form, so focus would fall to the page start: hand it across. Only when
  // the form held focus: a save can land after the user moved on.
  function close(hadFocus: boolean) {
    flushSync(() => setOpen(false));
    if (hadFocus) trigger.current?.focus();
  }

  if (!open) {
    return (
      <Button
        ref={trigger}
        id={SCHEDULE_FORM_FOCUS_ID}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {t("open")}
      </Button>
    );
  }
  return <OpenScheduleForm timezone={timezone} onClose={close} />;
}

function OpenScheduleForm({
  timezone,
  onClose,
}: {
  timezone?: string;
  /** Told whether focus was still in the form as it closes. */
  onClose: (hadFocus: boolean) => void;
}) {
  const botId = useSokoBotTargetId();
  const t = useTranslations("App.SokoBot.Schedules.Form");
  const tWhen = useTranslations("App.Tasks.Schedules.Dialog.When");
  const formatter = useFormatter();
  const ids = { prompt: useId(), next: useId() };
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [when, setWhen] = useState<ScheduleWhen>(() =>
    selectionToWhen({
      timezone: timezone ?? getDefaultTimezone(),
      cron: DEFAULT_CRON,
    }),
  );
  const [isPending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const close = () =>
    onClose(form.current?.contains(document.activeElement) ?? false);

  const cron = sokoBotScheduleCron(when);
  const valid = cron !== null && isValidCronExpression(cron, when.timezone);
  const [next] = valid
    ? upcomingRuns({ timezone: when.timezone, cron }, 1)
    : [];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cron || !valid) return;
    startTransition(async () => {
      const result = await createSokoBotScheduleAction({
        botId,
        input: {
          name: name.trim(),
          cronExpression: cron,
          timezone: when.timezone,
          prompt: prompt.trim(),
        },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      toast.success(t("created"));
      close();
    });
  }

  return (
    <form ref={form} onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        {/* The shared id: a deleted row hands focus here while the form is open. */}
        <Label htmlFor={SCHEDULE_FORM_FOCUS_ID}>{t("name")}</Label>
        <Input
          id={SCHEDULE_FORM_FOCUS_ID}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          required
          autoFocus
        />
      </div>
      <TaskScheduleWhen
        value={when}
        onChange={setWhen}
        repeats={REPEATS}
        showEnds={false}
      />
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p
          id={ids.next}
          aria-live="polite"
          className="text-muted-foreground mr-auto text-xs tabular-nums"
        >
          {next
            ? tWhen("next", {
                date: `${formatter.dateTime(next, "dateTimeMedium", {
                  timeZone: when.timezone,
                })} (${when.timezone.replaceAll("_", " ")})`,
              })
            : tWhen("noNext")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={close}
          disabled={isPending}
        >
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={isPending}
          disabled={!valid}
          aria-describedby={ids.next}
        >
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
