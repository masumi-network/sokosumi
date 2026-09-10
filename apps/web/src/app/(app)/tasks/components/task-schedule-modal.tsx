"use client";

import { useTranslations } from "next-intl";

import { TaskScheduleSection } from "@/components/task-schedule-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";

interface TaskScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSelection: TaskScheduleSelection;
  onApply: (selection: TaskScheduleSelection) => void;
  onClearSchedule: () => void;
}

export function TaskScheduleModal({
  open,
  onOpenChange,
  initialSelection,
  onApply,
  onClearSchedule,
}: TaskScheduleModalProps) {
  const t = useTranslations("App.Tasks.Schedule");

  function handleApply(selection: TaskScheduleSelection) {
    onApply(selection);
    onOpenChange(false);
  }

  function handleClearSchedule() {
    onClearSchedule();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {/* Radix unmounts the body on close, so reopening remounts it. */}
        <TaskScheduleSection
          key={`${initialSelection.mode}-${initialSelection.timezone}-${initialSelection.oneTimeLocalIso ?? ""}-${initialSelection.cron ?? ""}-${initialSelection.customCronExpr ?? ""}`}
          initialSelection={initialSelection}
          onSave={handleApply}
          onCancel={() => onOpenChange(false)}
          onClearSchedule={handleClearSchedule}
          canClearSchedule={initialSelection.mode !== "none"}
          hideHeader
        />
      </DialogContent>
    </Dialog>
  );
}
