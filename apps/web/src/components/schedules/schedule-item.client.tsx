"use client";

import { Clock, ClockFading, Pause, PencilLine, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { startTransition, useMemo, useOptimistic, useState } from "react";

import { JobScheduleSection } from "@/components/create-job-modal/job-schedule-section";
import JobDetailsInputs from "@/components/jobs/job-details/inputs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  deleteSchedule,
  toggleSchedule,
  updateSchedule,
} from "@/lib/actions/job-schedule";
import {
  JobScheduleEndsMode,
  JobScheduleSelectionType,
  JobScheduleType,
} from "@/lib/types/job";

interface ScheduleRecord {
  id: string;
  scheduleType: JobScheduleType;
  cron: string | null;
  oneTimeAtUtc: Date | null;
  timezone: string;
  endOnUtc: Date | null;
  endAfterOccurrences: number | null;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  input: string;
  inputSchema: string;
  pauseReason?: string | null;
}

interface Props {
  schedule: ScheduleRecord;
  title: string;
}

export function ScheduleItem({ schedule, title }: Props) {
  const t = useTranslations("App");
  const tScheduler = useTranslations("App.Agents.Jobs.CreateJob.Scheduler");
  const formatter = useFormatter();
  const [isEditOpen, setEditOpen] = useState(false);
  const [optimisticActive, setOptimisticActive] = useOptimistic(
    schedule.isActive,
  );

  async function handleToggle(next: boolean) {
    startTransition(() => {
      setOptimisticActive(next);
    });
    await toggleSchedule({ scheduleId: schedule.id, isActive: next });
  }

  const initialSelection = useMemo<JobScheduleSelectionType>(() => {
    if (schedule.scheduleType === JobScheduleType.ONE_TIME) {
      return {
        mode: JobScheduleType.ONE_TIME,
        timezone: schedule.timezone,
        oneTimeLocalIso: schedule.oneTimeAtUtc
          ? new Date(schedule.oneTimeAtUtc).toISOString().slice(0, 16)
          : new Date().toISOString().slice(0, 16),
      };
    }
    return {
      mode: JobScheduleType.CRON,
      timezone: schedule.timezone,
      cron: schedule.cron ?? undefined,
      // ends mapping is best-effort for preview/editing
      endsMode: schedule.endOnUtc
        ? JobScheduleEndsMode.ON
        : schedule.endAfterOccurrences
          ? JobScheduleEndsMode.AFTER
          : JobScheduleEndsMode.NEVER,
      endOnLocalDate: schedule.endOnUtc
        ? new Date(schedule.endOnUtc).toISOString().slice(0, 10)
        : undefined,
      endAfterOccurrences: schedule.endAfterOccurrences ?? undefined,
    };
  }, [schedule]);

  async function handleSave(selection: JobScheduleSelectionType) {
    if (selection.mode === JobScheduleType.ONE_TIME) {
      await updateSchedule({
        scheduleId: schedule.id,
        data: {
          scheduleType: JobScheduleType.ONE_TIME,
          timezone: selection.timezone,
          oneTimeAtUtc: selection.oneTimeLocalIso,
          cron: null,
          endOnUtc: null,
          endAfterOccurrences: null,
        },
      });
    } else if (selection.mode === JobScheduleType.CRON) {
      const endsMode = selection.endsMode as JobScheduleEndsMode | undefined;
      const endOnUtc =
        endsMode === "on" && selection.endOnLocalDate
          ? `${selection.endOnLocalDate}T23:59:59.999`
          : undefined;
      await updateSchedule({
        scheduleId: schedule.id,
        data: {
          scheduleType: JobScheduleType.CRON,
          timezone: selection.timezone,
          cron: selection.cron,
          oneTimeAtUtc: null,
          endOnUtc,
          endAfterOccurrences:
            endsMode === "after" ? (selection.endAfterOccurrences ?? 1) : null,
        },
      });
    }
    setEditOpen(false);
  }

  async function handleDelete() {
    await deleteSchedule({ scheduleId: schedule.id });
  }

  function formatTs(d: Date | string | null, tz: string): string {
    if (!d) return "—";
    try {
      const date = new Date(d);
      if (Number.isNaN(date.getTime())) return "—";
      return formatter.dateTime(date, {
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
        timeZone: tz,
      });
    } catch {
      return "—";
    }
  }

  return (
    <Card className="rounded-xl border">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="font-medium">{title}</div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {optimisticActive ? t("enabled") : t("disabled")}
            </span>
            <Switch checked={optimisticActive} onCheckedChange={handleToggle} />
          </div>
          <Dialog open={isEditOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <PencilLine className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{tScheduler("title")}</DialogTitle>
              </DialogHeader>
              <JobScheduleSection
                initialSelection={initialSelection}
                timezoneOptions={[schedule.timezone]}
                onSave={handleSave}
                onCancel={() => setEditOpen(false)}
              />
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive">
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>
                {t("Schedules.confirmDeleteTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("Schedules.confirmDeleteDescription")}
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                  {t("delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent>
        {schedule.pauseReason && (
          <div className="mb-4 flex flex-row">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-muted-foreground flex flex-row items-center gap-2 text-xs">
                  <Pause className="size-4" />
                  {schedule.pauseReason}
                </div>
              </TooltipTrigger>
              <TooltipContent>{t("Schedules.pausedReason")}</TooltipContent>
            </Tooltip>
          </div>
        )}
        <div className="text-muted-foreground flex flex-col gap-2 text-xs md:flex-row">
          <div className="flex flex-row gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-row gap-2">
                  <ClockFading className="size-4" />
                  {`${formatTs(schedule.lastRunAt, schedule.timezone)} (${schedule.timezone})`}
                </div>
              </TooltipTrigger>
              <TooltipContent>{t("Schedules.lastRun")}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-row gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-row gap-2">
                  <Clock className="size-4" />
                  {`${formatTs(schedule.nextRunAt, schedule.timezone)} (${schedule.timezone})`}
                </div>
              </TooltipTrigger>
              <TooltipContent>{t("Schedules.nextRun")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <Accordion type="single" collapsible className="mt-4">
          <AccordionItem
            value="input"
            className="bg-muted/50 rounded-xl border-none px-4"
          >
            <AccordionTrigger>{t("Schedules.inputPreview")}</AccordionTrigger>
            <AccordionContent>
              <JobDetailsInputs
                input={schedule.input}
                inputSchema={schedule.inputSchema}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

export default ScheduleItem;
