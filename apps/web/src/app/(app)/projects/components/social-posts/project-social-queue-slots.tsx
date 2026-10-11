"use client";

import type {
  SocialQueueSlot,
  SocialQueueSlots,
  SocialQueueSlotWrite,
} from "@sokosumi/core-client";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toActionRejectionError } from "@/lib/actions/errors/action-error";
import { replaceProjectSocialQueueSlots } from "@/lib/actions/project/action";
import {
  getDefaultTimezone,
  getTimezoneOptions,
} from "@/lib/schedules/timezones";

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_KEYS = [
  "weekdays.0",
  "weekdays.1",
  "weekdays.2",
  "weekdays.3",
  "weekdays.4",
  "weekdays.5",
  "weekdays.6",
] as const;
const MAX_SLOTS = 50;

interface DraftSlot {
  key: string;
  name: string;
  weekday: number;
  time: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function minutesToTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function toDraft(slot: SocialQueueSlot): DraftSlot {
  return {
    key: slot.id,
    name: slot.name,
    weekday: slot.weekday,
    time: minutesToTime(slot.minutesFromMidnight),
  };
}

function nextDraft(existing: readonly DraftSlot[]): DraftSlot {
  const taken = new Set(existing.map((slot) => `${slot.weekday}:${slot.time}`));
  for (const weekday of WEEKDAY_ORDER) {
    const time = "09:00";
    if (!taken.has(`${weekday}:${time}`)) {
      return {
        key: `new-${weekday}-${time}-${existing.length}`,
        name: "",
        weekday,
        time,
      };
    }
  }
  return {
    key: `new-${existing.length}`,
    name: "",
    weekday: 1,
    time: "09:00",
  };
}

interface ProjectSocialQueueSlotsProps {
  projectId: string;
  queueSlots: SocialQueueSlots;
}

export function ProjectSocialQueueSlots({
  projectId,
  queueSlots,
}: ProjectSocialQueueSlotsProps) {
  const router = useRouter();
  const t = useTranslations("App.Projects.SocialPosts.queue");
  const [timezone, setTimezone] = useState(
    queueSlots.timezone ?? getDefaultTimezone(),
  );
  const [slots, setSlots] = useState<DraftSlot[]>(() =>
    queueSlots.slots.map(toDraft),
  );
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => getTimezoneOptions(timezone), [timezone]);

  function weekdayLabel(weekday: number): string {
    return t(WEEKDAY_KEYS[weekday] ?? "weekdays.0");
  }

  async function handleSave(): Promise<void> {
    const next: SocialQueueSlotWrite[] = [];
    for (const slot of slots) {
      const minutes = timeToMinutes(slot.time);
      if (minutes === null) return;
      const name =
        slot.name.trim() || `${weekdayLabel(slot.weekday)} ${slot.time}`;
      next.push({
        name: name.slice(0, 40),
        weekday: slot.weekday,
        minutesFromMidnight: minutes,
      });
    }
    setSaving(true);
    try {
      const result = await replaceProjectSocialQueueSlots({
        projectId,
        timezone,
        slots: next,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setSlots(result.value.slots.map(toDraft));
      setTimezone(result.value.timezone ?? timezone);
      toast.success(
        result.value.slots.length === 0 ? t("toasts.empty") : t("toasts.saved"),
      );
      router.refresh();
    } catch (error) {
      toast.error(toActionRejectionError(error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4" data-testid="social-queue-slots">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="text-muted-foreground text-sm">{t("hint")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 shrink-0 md:h-8"
          disabled={slots.length >= MAX_SLOTS}
          onClick={() =>
            setSlots((current) => [...current, nextDraft(current)])
          }
        >
          <Plus className="size-4" aria-hidden />
          {t("add")}
        </Button>
      </div>

      <div className="grid max-w-md gap-2">
        <Label htmlFor="social-queue-timezone">{t("timezone")}</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger id="social-queue-timezone" className="h-11 md:h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {zones.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {slots.length === 0 ? (
        <EmptyState description={t("emptyHint")} title={t("empty")} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {slots.map((slot) => (
            <li
              key={slot.key}
              className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_8rem_7rem_auto] md:items-end"
            >
              <div className="grid gap-1.5">
                <Label htmlFor={`social-queue-name-${slot.key}`}>
                  {t("name")}
                </Label>
                <Input
                  id={`social-queue-name-${slot.key}`}
                  maxLength={40}
                  value={slot.name}
                  placeholder={`${weekdayLabel(slot.weekday)} ${slot.time}`}
                  onChange={(event) => {
                    const name = event.target.value;
                    setSlots((current) =>
                      current.map((row) =>
                        row.key === slot.key ? { ...row, name } : row,
                      ),
                    );
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`social-queue-day-${slot.key}`}>
                  {t("weekday")}
                </Label>
                <Select
                  value={String(slot.weekday)}
                  onValueChange={(value) => {
                    setSlots((current) =>
                      current.map((row) =>
                        row.key === slot.key
                          ? { ...row, weekday: Number(value) }
                          : row,
                      ),
                    );
                  }}
                >
                  <SelectTrigger
                    id={`social-queue-day-${slot.key}`}
                    className="h-11 md:h-8"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_ORDER.map((weekday) => (
                      <SelectItem key={weekday} value={String(weekday)}>
                        {weekdayLabel(weekday)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`social-queue-time-${slot.key}`}>
                  {t("time")}
                </Label>
                <Input
                  id={`social-queue-time-${slot.key}`}
                  type="time"
                  value={slot.time}
                  onChange={(event) => {
                    const time = event.target.value;
                    setSlots((current) =>
                      current.map((row) =>
                        row.key === slot.key ? { ...row, time } : row,
                      ),
                    );
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 md:h-8"
                aria-label={t("remove", {
                  name:
                    slot.name || `${weekdayLabel(slot.weekday)} ${slot.time}`,
                })}
                onClick={() =>
                  setSlots((current) =>
                    current.filter((row) => row.key !== slot.key),
                  )
                }
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button
          type="button"
          size="sm"
          className="h-11 md:h-8"
          loading={saving}
          onClick={() => {
            void handleSave();
          }}
        >
          {t("save")}
        </Button>
      </div>
    </section>
  );
}
