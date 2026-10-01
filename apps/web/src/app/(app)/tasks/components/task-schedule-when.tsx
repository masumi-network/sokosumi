"use client";

import { CalendarDays, Check, ChevronDown, Clock, Globe } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DOW, type Dow, formatWeekday } from "@/lib/schedules/cron";
import type {
  ScheduleRepeat,
  ScheduleWhen,
} from "@/lib/schedules/schedule-when";
import { getTimezoneOptions } from "@/lib/schedules/timezones";
import { TaskScheduleEndsMode } from "@/lib/types/task-schedule";
import { cn } from "@/lib/utils";
import { isValidCronExpression } from "@/lib/utils/task-schedule";

const REPEATS: ScheduleRepeat[] = [
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "interval",
  "custom",
];

/** Monday first, the way people read a week. */
const WEEK: Dow[] = [...DOW.slice(1), DOW[0]];

const TIME_SLOTS = Array.from({ length: 96 }, (_, index) => {
  const hours = String(Math.floor(index / 4)).padStart(2, "0");
  const minutes = String((index % 4) * 15).padStart(2, "0");
  return `${hours}:${minutes}`;
});

const TYPED_TIME = /^([01]?\d|2[0-3])[:.]?([0-5]\d)$/;

/** The chip every control in this section shares, as in the New Task form. */
export const scheduleChipClass =
  "focus-visible:ring-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2";

function chipClass(active: boolean) {
  return cn(
    scheduleChipClass,
    active
      ? "bg-foreground text-background border-transparent"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  );
}

function normalizeTypedTime(value: string): string | null {
  const match = TYPED_TIME.exec(value.trim());
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function localDateToDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function dateToLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-3 gap-y-1.5 sm:grid-cols-[5rem_1fr]">
      <label
        htmlFor={htmlFor}
        className="text-muted-foreground text-sm font-medium sm:leading-7"
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

function MenuChip({
  label,
  value,
  options,
  onChange,
  contentClassName,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  contentClassName?: string;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className={chipClass(false)}>
          <span className="text-foreground">{current?.label}</span>
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={contentClassName}>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TimeChip({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("App.Tasks.Schedules.Dialog.When");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typed = normalizeTypedTime(query);
  // The list opens at the slot nearest the current time, not at midnight.
  const nearest =
    [...TIME_SLOTS].reverse().find((slot) => slot <= value) ?? TIME_SLOTS[0];

  function pick(time: string) {
    onChange(time);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("time")}
          className={chipClass(false)}
        >
          <Clock className="size-3.5" aria-hidden />
          <span className="text-foreground tabular-nums">{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        <Command defaultValue={nearest}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("timeSearch")}
          />
          <CommandList className="max-h-60">
            {typed && !TIME_SLOTS.includes(typed) ? (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`typed-${typed}`}
                  onSelect={() => pick(typed)}
                >
                  {t("useTime", { time: typed })}
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              {TIME_SLOTS.map((slot) => (
                <CommandItem
                  key={slot}
                  ref={
                    slot === nearest
                      ? (element) =>
                          element?.scrollIntoView({ block: "center" })
                      : undefined
                  }
                  value={slot}
                  onSelect={() => pick(slot)}
                  className="tabular-nums"
                >
                  <span className="flex-1">{slot}</span>
                  {slot === value ? (
                    <Check className="size-4" aria-hidden />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TimezoneChip({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("App.Tasks.Schedules.Dialog.When");
  const [open, setOpen] = useState(false);
  const options = useMemo(() => getTimezoneOptions(value), [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("timezone")}
          className={chipClass(false)}
        >
          <Globe className="size-3.5" aria-hidden />
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={t("timezoneSearch")} />
          <CommandList className="max-h-60">
            <CommandEmpty>{t("noTimezone")}</CommandEmpty>
            <CommandGroup>
              {options.map((zone) => (
                <CommandItem
                  key={zone}
                  value={zone}
                  onSelect={() => {
                    onChange(zone);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{zone}</span>
                  {zone === value ? (
                    <Check className="size-4" aria-hidden />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DateChip({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string | null;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  const formatter = useFormatter();
  const [open, setOpen] = useState(false);
  const selected = localDateToDate(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={chipClass(false)}>
          <CalendarDays className="size-3.5" aria-hidden />
          <span className={cn(selected && "text-foreground")}>
            {selected
              ? formatter.dateTime(selected, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          disabled={{ before: today }}
          onSelect={(date) => {
            if (!date) return;
            onChange(dateToLocalDate(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface TaskScheduleWhenProps {
  value: ScheduleWhen;
  onChange: (value: ScheduleWhen) => void;
}

/** The "When" part of the schedule dialog: how often, at what time, until when. */
export function TaskScheduleWhen({ value, onChange }: TaskScheduleWhenProps) {
  const t = useTranslations("App.Tasks.Schedules.Dialog.When");
  const formatter = useFormatter();
  const cronId = useId();
  const intervalId = useId();
  const endAfterId = useId();
  const set = (patch: Partial<ScheduleWhen>) =>
    onChange({ ...value, ...patch });
  const cronInvalid =
    value.repeat === "custom" &&
    value.customCron.trim() !== "" &&
    !isValidCronExpression(value.customCron.trim(), value.timezone);

  return (
    <div className="space-y-3">
      <Row label={t("repeat")}>
        {REPEATS.map((repeat) => (
          <button
            key={repeat}
            type="button"
            aria-pressed={value.repeat === repeat}
            className={chipClass(value.repeat === repeat)}
            onClick={() => set({ repeat })}
          >
            {t(`repeats.${repeat}`)}
          </button>
        ))}
      </Row>

      {value.repeat === "weekly" ? (
        <Row label={t("on")}>
          {WEEK.map((day) => {
            const active = value.weekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                data-weekday={day}
                aria-pressed={active}
                aria-label={formatWeekday(day, formatter)}
                className={cn(chipClass(active), "w-11 justify-center px-0")}
                onClick={() =>
                  set({
                    weekdays: active
                      ? value.weekdays.filter((item) => item !== day)
                      : [...value.weekdays, day],
                  })
                }
              >
                {formatWeekday(day, formatter).slice(0, 3)}
              </button>
            );
          })}
          {value.weekdays.length === 0 ? (
            <span className="text-destructive text-xs">{t("pickADay")}</span>
          ) : null}
        </Row>
      ) : null}

      {value.repeat === "monthly" ? (
        <Row label={t("on")}>
          <MenuChip
            label={t("dayOfMonth")}
            value={String(value.dayOfMonth)}
            onChange={(day) => set({ dayOfMonth: Number(day) })}
            contentClassName="max-h-64 overflow-y-auto"
            options={Array.from({ length: 31 }, (_, index) => ({
              value: String(index + 1),
              label: t("dayN", { day: index + 1 }),
            }))}
          />
          {value.dayOfMonth > 28 ? (
            <span className="text-muted-foreground text-xs">
              {t("shortMonths")}
            </span>
          ) : null}
        </Row>
      ) : null}

      {value.repeat === "interval" ? (
        <Row label={t("every")} htmlFor={intervalId}>
          <Input
            id={intervalId}
            type="number"
            min={2}
            max={365}
            value={value.intervalDays}
            onChange={(event) =>
              set({
                intervalDays: Math.max(2, Number(event.target.value) || 2),
              })
            }
            className="h-7 w-16 rounded-full px-3 text-xs tabular-nums"
          />
          <span className="text-muted-foreground text-xs">{t("days")}</span>
          <span className="text-muted-foreground text-xs">{t("starting")}</span>
          <DateChip
            value={value.startDate}
            onChange={(startDate) => set({ startDate })}
            label={t("startDate")}
            placeholder={t("pickDate")}
          />
        </Row>
      ) : null}

      {value.repeat === "custom" ? (
        <Row label={t("cron")} htmlFor={cronId}>
          <div className="w-full space-y-1">
            <Input
              id={cronId}
              value={value.customCron}
              onChange={(event) => set({ customCron: event.target.value })}
              placeholder="0 9 * * MON"
              spellCheck={false}
              aria-invalid={cronInvalid || undefined}
              className="h-8 font-mono text-xs"
            />
            <p
              className={cn(
                "text-xs",
                cronInvalid ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {cronInvalid ? t("cronInvalid") : t("cronHelp")}
            </p>
          </div>
        </Row>
      ) : (
        <Row label={t("at")}>
          <TimeChip value={value.time} onChange={(time) => set({ time })} />
          <TimezoneChip
            value={value.timezone}
            onChange={(timezone) => set({ timezone })}
          />
        </Row>
      )}

      {value.repeat === "custom" ? (
        <Row label={t("timezone")}>
          <TimezoneChip
            value={value.timezone}
            onChange={(timezone) => set({ timezone })}
          />
        </Row>
      ) : null}

      <Row label={t("ends")} htmlFor={endAfterId}>
        <MenuChip
          label={t("ends")}
          value={value.endsMode}
          onChange={(endsMode) =>
            set({ endsMode: endsMode as TaskScheduleEndsMode })
          }
          options={[
            { value: TaskScheduleEndsMode.NEVER, label: t("endsNever") },
            { value: TaskScheduleEndsMode.ON, label: t("endsOn") },
            { value: TaskScheduleEndsMode.AFTER, label: t("endsAfter") },
          ]}
        />
        {value.endsMode === TaskScheduleEndsMode.ON ? (
          <DateChip
            value={value.endOnLocalDate}
            onChange={(endOnLocalDate) => set({ endOnLocalDate })}
            label={t("endDate")}
            placeholder={t("pickDate")}
          />
        ) : null}
        {value.endsMode === TaskScheduleEndsMode.AFTER ? (
          <>
            <Input
              id={endAfterId}
              type="number"
              min={1}
              value={value.endAfterOccurrences}
              onChange={(event) =>
                set({
                  endAfterOccurrences: Math.max(
                    1,
                    Number(event.target.value) || 1,
                  ),
                })
              }
              className="h-7 w-16 rounded-full px-3 text-xs tabular-nums"
            />
            <span className="text-muted-foreground text-xs">{t("runs")}</span>
          </>
        ) : null}
      </Row>
    </div>
  );
}
