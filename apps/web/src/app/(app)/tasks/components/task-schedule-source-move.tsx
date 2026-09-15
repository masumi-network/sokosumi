"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { moveCalendarTaskSource } from "@/lib/actions/task/action";
import type {
  CalendarTaskScheduleSource,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import { taskScheduleSeriesFeedbackKey } from "@/lib/utils/task-schedule-feedback";

interface TaskScheduleSourceMoveProps {
  taskId: string;
  currentSourceId: string;
  scheduleRevision: number;
  futureExceptionCount: number;
  sources: WorkspaceCalendarSource[];
}

function toCalendarSource(sourceId: string): CalendarTaskScheduleSource {
  if (sourceId.startsWith("project:")) {
    return { type: "project", projectId: sourceId.slice("project:".length) };
  }
  return { type: "workspace" };
}

export function TaskScheduleSourceMove({
  taskId,
  currentSourceId,
  scheduleRevision,
  futureExceptionCount,
  sources,
}: TaskScheduleSourceMoveProps) {
  const t = useTranslations("App.Tasks.Detail.ScheduleSeries");
  const tSeries = useTranslations("App.Tasks.Schedule.series");
  const router = useRouter();
  const selectableSources = sources.filter(
    (source) =>
      source.isSchedulable &&
      (source.sourceType === "WORKSPACE" || source.sourceType === "PROJECT"),
  );
  const [open, setOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState(currentSourceId);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<{ sourceId: string; operationId: string } | null>(
    null,
  );

  if (
    selectableSources.filter((source) => source.sourceId !== currentSourceId)
      .length === 0
  ) {
    return null;
  }

  async function handleMove() {
    if (selectedSourceId === currentSourceId) return;
    if (operation.current?.sourceId !== selectedSourceId) {
      operation.current = {
        sourceId: selectedSourceId,
        operationId: crypto.randomUUID(),
      };
    }

    setIsPending(true);
    setError(null);
    try {
      const result = await moveCalendarTaskSource({
        taskId,
        operationId: operation.current.operationId,
        expectedScheduleRevision: scheduleRevision,
        source: toCalendarSource(selectedSourceId),
      });
      if (!result.ok) {
        const feedbackKey = taskScheduleSeriesFeedbackKey(result.error.kind);
        setError(feedbackKey ? tSeries(feedbackKey) : t("moveSourceError"));
        return;
      }

      toast.success(t("moveSourceSuccess"));
      setOpen(false);
      router.refresh();
    } catch (moveError) {
      console.error("Failed to move Calendar source", moveError);
      setError(t("moveSourceError"));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setSelectedSourceId(currentSourceId);
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {t("moveSource")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("moveSourceTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("moveSourceDescription", { count: futureExceptionCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
          <SelectTrigger aria-label={t("moveSourceLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {selectableSources.map((source) => (
              <SelectItem key={source.sourceId} value={source.sourceId}>
                {source.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {t("moveSourceCancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={isPending || selectedSourceId === currentSourceId}
            onClick={() => void handleMove()}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {t("moveSourceConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
