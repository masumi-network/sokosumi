"use client";

import cronParser from "cron-parser";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
type Dow = (typeof DOW)[number];

export interface ScheduleSelection {
  mode: "NOW" | "ONE_TIME" | "CRON";
  timezone: string;
  oneTimeLocalIso?: string;
  cron?: string;
}

interface Props {
  timezoneOptions: string[];
  onSave: (selection: ScheduleSelection) => void;
  onCancel: () => void;
}

export function ScheduleSectionClient(props: Props) {
  const t = useTranslations("App.Agents.Jobs.CreateJob.Scheduler");
  const [mode, setMode] = useState<"NOW" | "ONE_TIME" | "CRON">("NOW");
  const [timezone] = useState<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [oneTimeLocalIso, setOneTimeLocalIso] = useState<string>("");
  // Note: We derive cron expression from builder fields; no separate cron state needed
  // Recurrence builder state (for CRON UI)
  const [repeatEveryCount, setRepeatEveryCount] = useState<number>(1);
  const [repeatEveryUnit, setRepeatEveryUnit] = useState<
    "day" | "week" | "month"
  >("week");
  const [repeatWeekdays, setRepeatWeekdays] = useState<Dow[]>(["MO"]);
  const [endsMode, setEndsMode] = useState<"never" | "on" | "after">("never");
  const [endOnDate, setEndOnDate] = useState<Date | undefined>(undefined);
  const [endAfterOccurrences, setEndAfterOccurrences] = useState<number>(13);

  const buildCronFromSelections = useCallback((): string => {
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();
    if (repeatEveryUnit === "day") {
      return `${minute} ${hour} */${Math.max(1, repeatEveryCount)} * *`;
    }
    if (repeatEveryUnit === "week") {
      const fallbackDay: Dow = DOW[now.getDay() as number];
      const days = (
        repeatWeekdays.length ? repeatWeekdays : [fallbackDay]
      ).join(",");
      return `${minute} ${hour} * * ${days}`;
    }
    const dayOfMonth = now.getDate();
    return `${minute} ${hour} ${dayOfMonth} */${Math.max(1, repeatEveryCount)} *`;
  }, [repeatEveryUnit, repeatEveryCount, repeatWeekdays]);

  const computedCron = useMemo(() => {
    if (mode !== "CRON") return "";
    return buildCronFromSelections();
  }, [mode, buildCronFromSelections]);

  const nextPreview = useMemo(() => {
    if (mode !== "CRON") return [] as string[];
    if (!computedCron) return [] as string[];
    try {
      const options = { currentDate: new Date(), tz: timezone } as const;
      const interval = cronParser.parse(computedCron, options);
      const maxCount = Math.max(
        1,
        Math.min(3, endsMode === "after" ? endAfterOccurrences : 3),
      );
      const results: string[] = [];
      let safety = 20;
      while (results.length < maxCount && safety > 0) {
        const nextDate = interval.next().toDate();
        if (endsMode === "on" && endOnDate) {
          if (nextDate > endOnDate) break;
        }
        results.push(
          nextDate.toLocaleString(undefined, { timeZone: timezone }),
        );
        safety--;
      }
      return results;
    } catch {
      return [];
    }
  }, [computedCron, timezone, mode, endsMode, endOnDate, endAfterOccurrences]);

  // buildCronFromSelections is defined above with useCallback

  function handleSave() {
    if (mode === "CRON") {
      const cronExpression = buildCronFromSelections();
      props.onSave({ mode: "CRON", timezone, cron: cronExpression });
      return;
    }
    if (mode === "ONE_TIME") {
      props.onSave({ mode: "ONE_TIME", timezone, oneTimeLocalIso });
      return;
    }
    props.onSave({ mode: "NOW", timezone });
  }

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === "NOW" ? "default" : "secondary"}
          onClick={() => setMode("NOW")}
        >
          {t("modeNow")}
        </Button>
        <Button
          type="button"
          variant={mode === "ONE_TIME" ? "default" : "secondary"}
          onClick={() => setMode("ONE_TIME")}
        >
          {t("modeOneTime")}
        </Button>
        <Button
          type="button"
          variant={mode === "CRON" ? "default" : "secondary"}
          onClick={() => setMode("CRON")}
        >
          {t("modeRecurring")}
        </Button>
      </div>
      {mode === "ONE_TIME" && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2">
            <Label>{t("pickDateTime")}</Label>
            <Input
              type="datetime-local"
              onChange={(e) => setOneTimeLocalIso(e.target.value)}
            />
          </div>
        </div>
      )}
      {mode === "CRON" && (
        <div className="space-y-6">
          {/* Repeat every */}
          <div className="space-y-2">
            <Label className="text-base">{t("repeatEvery")}</Label>
            <div className="flex items-center gap-3">
              <Input
                inputMode="numeric"
                type="number"
                min={1}
                value={repeatEveryCount}
                onChange={(e) =>
                  setRepeatEveryCount(Math.max(1, Number(e.target.value)))
                }
                className="w-24"
              />
              <Select
                value={repeatEveryUnit}
                onValueChange={(v) =>
                  setRepeatEveryUnit(v as "day" | "week" | "month")
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{t("unit.day")}</SelectItem>
                  <SelectItem value="week">{t("unit.week")}</SelectItem>
                  <SelectItem value="month">{t("unit.month")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Repeat on (weekdays) */}
          <div className="space-y-2">
            <Label
              className={cn(
                "text-base",
                repeatEveryUnit !== "week" && "opacity-60",
              )}
            >
              {t("repeatOn")}
            </Label>
            <ToggleGroup
              type="multiple"
              variant="outline"
              value={repeatWeekdays}
              onValueChange={(value) =>
                setRepeatWeekdays(value as typeof repeatWeekdays)
              }
              className="grid w-fit grid-cols-7 gap-2"
              disabled={repeatEveryUnit !== "week"}
            >
              {(
                [
                  { v: "SU", l: "S" },
                  { v: "MO", l: "M" },
                  { v: "TU", l: "T" },
                  { v: "WE", l: "W" },
                  { v: "TH", l: "T" },
                  { v: "FR", l: "F" },
                  { v: "SA", l: "S" },
                ] as const
              ).map((d) => (
                <ToggleGroupItem
                  key={d.v}
                  value={d.v}
                  aria-label={d.v}
                  className="size-9"
                >
                  {d.l}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {/* Ends */}
          <div className="space-y-3">
            <Label className="text-base">{t("ends")}</Label>
            <RadioGroup
              value={endsMode}
              onValueChange={(v) => setEndsMode(v as "never" | "on" | "after")}
              className="space-y-3"
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem id="ends-never" value="never" />
                <Label htmlFor="ends-never">{t("never")}</Label>
              </div>
              <div className="flex items-center gap-3">
                <RadioGroupItem id="ends-on" value="on" />
                <Label htmlFor="ends-on" className="mr-2">
                  {t("on")}
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-[200px] justify-start"
                    >
                      {endOnDate
                        ? endOnDate.toLocaleDateString()
                        : t("pickDate")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endOnDate}
                      onSelect={(d) => setEndOnDate(d ?? undefined)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-3">
                <RadioGroupItem id="ends-after" value="after" />
                <Label htmlFor="ends-after" className="mr-2">
                  {t("after")}
                </Label>
                <Input
                  inputMode="numeric"
                  type="number"
                  min={1}
                  value={endAfterOccurrences}
                  onChange={(e) =>
                    setEndAfterOccurrences(Math.max(1, Number(e.target.value)))
                  }
                  className="w-28"
                />
                <span className="text-muted-foreground text-sm">
                  {t("occurrences")}
                </span>
              </div>
            </RadioGroup>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <Label className="text-base">{t("preview")}</Label>
            <div
              className={cn(
                "rounded-md border p-3",
                nextPreview.length === 0 && "opacity-60",
              )}
            >
              {nextPreview.length > 0 ? (
                <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                  {nextPreview.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-muted-foreground text-sm">
                  {t("noPreview")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Footer buttons */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            // reset state and close via parent
            setRepeatEveryCount(1);
            setRepeatEveryUnit("week");
            setRepeatWeekdays(["MO"]);
            setEndsMode("never");
            setEndOnDate(undefined);
            setEndAfterOccurrences(13);
            setMode("NOW");
            props.onCancel();
          }}
        >
          {t("cancel")}
        </Button>
        <Button type="button" onClick={handleSave}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
