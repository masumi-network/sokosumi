"use client";

import { ExternalLink, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  type DesignMdAdHocAttachment,
  DesignMdAdHocDialog,
} from "@/components/design-md";
import { Checkbox } from "@/components/ui/checkbox";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";
import { cn } from "@/lib/utils";

const DESIGN_MD_LEARN_MORE_URL =
  "https://github.com/google-labs-code/design.md";

export interface TaskDesignMdSelection {
  enabled: boolean;
  /** Set once the user swaps in another company's branding for this task
   * only — never persisted anywhere beyond this task's description. */
  custom: DesignMdAdHocAttachment | null;
}

interface TaskDesignMdAttachmentFieldProps {
  /** The org's or the caller's own effective DESIGN.md — this field only
   * renders when the caller has one to offer. */
  defaultAttachment: EffectiveDesignMdAttachment;
  selection: TaskDesignMdSelection;
  onSelectionChange: (next: TaskDesignMdSelection) => void;
  className?: string;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function TaskDesignMdAttachmentField({
  defaultAttachment,
  selection,
  onSelectionChange,
  className,
}: TaskDesignMdAttachmentFieldProps) {
  const t = useTranslations("App.Tasks.NewTask.DesignMdAttachment");
  const [isAdHocDialogOpen, setIsAdHocDialogOpen] = useState(false);

  const defaultLabel =
    defaultAttachment.owner.type === "organization"
      ? t("organizationLabel", { organization: defaultAttachment.owner.name })
      : t("personalLabel");

  const displayLabel = selection.custom
    ? t("customLabel", { hostname: getHostname(selection.custom.sourceUrl) })
    : defaultLabel;

  // The wording only makes sense pointed at a real, named owner — a custom
  // ad hoc attachment describes itself well enough via its label already.
  const tooltipText =
    defaultAttachment.owner.type === "organization"
      ? t("tooltip", { organization: defaultAttachment.owner.name })
      : t("tooltipPersonal");

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border p-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Checkbox
          id="task-design-md-attachment"
          checked={selection.enabled}
          onCheckedChange={(checked) =>
            onSelectionChange({ ...selection, enabled: checked === true })
          }
        />
        <label
          htmlFor="task-design-md-attachment"
          className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
          title={displayLabel}
        >
          {displayLabel}
        </label>
        <HoverCard openDelay={150}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              aria-label={t("infoAria")}
              className="focus-visible:ring-ring inline-flex size-5 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
            >
              <Info
                className="text-muted-foreground/70 hover:text-foreground size-3.5 transition-colors"
                aria-hidden
              />
            </button>
          </HoverCardTrigger>
          <HoverCardContent side="top" align="start" className="w-72 text-sm">
            <p className="text-muted-foreground">{tooltipText}</p>
            <a
              href={DESIGN_MD_LEARN_MORE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-primary mt-2 inline-flex items-center gap-1 font-medium hover:underline"
            >
              {t("learnMore")}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </HoverCardContent>
        </HoverCard>
      </div>

      <button
        type="button"
        className="text-primary shrink-0 text-xs font-medium hover:underline"
        onClick={() => {
          if (selection.custom) {
            onSelectionChange({ ...selection, custom: null });
            return;
          }
          setIsAdHocDialogOpen(true);
        }}
      >
        {selection.custom ? t("resetToDefault") : t("useDifferentBranding")}
      </button>

      <DesignMdAdHocDialog
        open={isAdHocDialogOpen}
        onOpenChange={setIsAdHocDialogOpen}
        onGenerated={(custom) => {
          onSelectionChange({ enabled: true, custom });
          setIsAdHocDialogOpen(false);
        }}
      />
    </div>
  );
}
