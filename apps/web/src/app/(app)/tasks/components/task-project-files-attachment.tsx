"use client";

import { FileText, Info } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export interface TaskProjectFilesSelection {
  briefingEnabled: boolean;
  contextMdEnabled: boolean;
}

interface TaskProjectFilesAttachmentFieldProps {
  selection: TaskProjectFilesSelection;
  onSelectionChange: (next: TaskProjectFilesSelection) => void;
  contextMdUpdatedAt?: string | Date | null;
  className?: string;
}

interface ProjectFileAttachmentRowProps {
  id: string;
  fileName: string;
  description: string;
  info: string;
  infoAria: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ProjectFileAttachmentRow({
  id,
  fileName,
  description,
  info,
  infoAria,
  checked,
  onCheckedChange,
}: ProjectFileAttachmentRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border p-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
      />
      <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
        <FileText className="text-muted-foreground size-3.5" aria-hidden />
      </span>
      <label
        htmlFor={id}
        className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5"
      >
        <span className="shrink-0 text-sm font-medium">{fileName}</span>
        <span className="text-muted-foreground truncate text-xs">
          {description}
        </span>
      </label>
      <HoverCard openDelay={150}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label={infoAria}
            className="text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-5 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="start" className="w-72 text-sm">
          <p className="text-muted-foreground">{info}</p>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

export function TaskProjectFilesAttachmentField({
  selection,
  onSelectionChange,
  contextMdUpdatedAt,
  className,
}: TaskProjectFilesAttachmentFieldProps) {
  const t = useTranslations("App.Tasks.NewTask.ProjectFilesAttachment");
  const formatter = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const contextUpdatedAtDate =
    typeof contextMdUpdatedAt === "string"
      ? new Date(contextMdUpdatedAt)
      : contextMdUpdatedAt;
  const hasValidContextUpdatedAt =
    contextUpdatedAtDate instanceof Date &&
    !Number.isNaN(contextUpdatedAtDate.getTime());
  const contextDescription = hasValidContextUpdatedAt
    ? t("contextDescriptionUpdated", {
        when: formatter.relativeTime(contextUpdatedAtDate, now),
      })
    : t("contextDescription");

  return (
    <div className={cn("space-y-2", className)}>
      <ProjectFileAttachmentRow
        id="task-project-briefing-attachment"
        fileName="BRIEFING.md"
        description={t("briefingDescription")}
        info={t("briefingInfo")}
        infoAria={t("briefingInfoAria")}
        checked={selection.briefingEnabled}
        onCheckedChange={(briefingEnabled) =>
          onSelectionChange({ ...selection, briefingEnabled })
        }
      />
      <ProjectFileAttachmentRow
        id="task-project-context-md-attachment"
        fileName="CONTEXT.md"
        description={contextDescription}
        info={t("contextInfo")}
        infoAria={t("contextInfoAria")}
        checked={selection.contextMdEnabled}
        onCheckedChange={(contextMdEnabled) =>
          onSelectionChange({ ...selection, contextMdEnabled })
        }
      />
    </div>
  );
}
