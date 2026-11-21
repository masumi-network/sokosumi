"use client";

import type { TeamStandup } from "@sokosumi/core-client";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { saveTeamStandup } from "@/lib/actions/team-standup/action";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

interface TeamStandupFormProps {
  organizationId: string;
  initial: TeamStandup;
  canEdit: boolean;
}

/** On/off, time, weekdays and time zone of the organization's daily agent stand-up. */
export function TeamStandupForm({
  organizationId,
  initial,
  canEdit,
}: TeamStandupFormProps) {
  const t = useTranslations("App.TeamStandup");
  const locale = useLocale();
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [timeOfDay, setTimeOfDay] = useState(initial.timeOfDay);
  const [weekdays, setWeekdays] = useState(initial.weekdays.map(String));
  const [timezone, setTimezone] = useState(initial.timezone);
  const [pending, startTransition] = useTransition();
  const changed =
    enabled !== saved.enabled ||
    timeOfDay !== saved.timeOfDay ||
    timezone !== saved.timezone ||
    weekdays.join() !== saved.weekdays.map(String).join();

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveTeamStandup({
        organizationId,
        enabled,
        timeOfDay,
        weekdays: weekdays.map(Number).sort(),
        timezone,
      });
      if (!result.ok) {
        toast.error(t("saveError"));
        return;
      }
      setSaved(result.value);
      setWeekdays(result.value.weekdays.map(String));
      toast.success(t("saved"));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor={`standup-on-${organizationId}`}>
                {t("enabledLabel")}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t("enabledHelp")}
              </p>
            </div>
            <Switch
              id={`standup-on-${organizationId}`}
              checked={enabled}
              disabled={!canEdit || pending}
              onCheckedChange={setEnabled}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`standup-time-${organizationId}`}>
                {t("timeLabel")}
              </Label>
              <Input
                id={`standup-time-${organizationId}`}
                value={timeOfDay}
                inputMode="numeric"
                placeholder="09:00"
                disabled={!canEdit || pending}
                onChange={(event) => setTimeOfDay(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`standup-zone-${organizationId}`}>
                {t("timezoneLabel")}
              </Label>
              <Input
                id={`standup-zone-${organizationId}`}
                value={timezone}
                placeholder="Europe/Berlin"
                disabled={!canEdit || pending}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("weekdaysLabel")}</Label>
            <ToggleGroup
              type="multiple"
              value={weekdays}
              disabled={!canEdit || pending}
              onValueChange={(value) => {
                if (value.length) setWeekdays(value);
              }}
            >
              {WEEKDAYS.map((day) => (
                <ToggleGroupItem key={day} value={String(day)}>
                  {t(`weekday.${day}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {saved.enabled && saved.nextRunAt ? (
            <p className="text-muted-foreground text-sm">
              {t("next", {
                when: new Intl.DateTimeFormat(locale, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: saved.timezone,
                }).format(new Date(saved.nextRunAt)),
                zone: saved.timezone,
              })}
            </p>
          ) : null}
          {canEdit ? (
            <Button
              type="submit"
              size="sm"
              loading={pending}
              disabled={!changed || pending}
            >
              {t("save")}
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">{t("adminOnly")}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
