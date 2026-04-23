"use client";

import { useTranslations } from "next-intl";
import type { TaskSubmitStatus } from "@/app/chat/utils/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TaskSubmitStatusSelectProps {
  value: TaskSubmitStatus;
  onValueChange: (value: TaskSubmitStatus) => void;
}

export function TaskSubmitStatusSelect({
  value,
  onValueChange,
}: TaskSubmitStatusSelectProps) {
  const t = useTranslations("App.Chat.Chat");

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === "READY" || v === "DRAFT") {
          onValueChange(v);
        }
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("taskStatus")}
        className="hover:bg-muted h-8 border-none px-2 shadow-none"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" side="top">
        <SelectItem value="READY">{t("taskStatusReady")}</SelectItem>
        <SelectItem value="DRAFT">{t("taskStatusDraft")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
