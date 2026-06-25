"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
  const [draftSelection, setDraftSelection] =
    useState<TaskScheduleSelection>(initialSelection);

  useEffect(() => {
    if (!open) return;
    setDraftSelection(initialSelection);
  }, [initialSelection, open]);

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
        <TaskScheduleSection
          key={`${open}-${draftSelection.mode}-${draftSelection.timezone}-${draftSelection.oneTimeLocalIso ?? ""}-${draftSelection.cron ?? ""}-${draftSelection.customCronExpr ?? ""}`}
          initialSelection={draftSelection}
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
