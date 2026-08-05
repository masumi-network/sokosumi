"use client";

import { ExternalLink, FileText, Globe, Info, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  type DesignMdAdHocAttachment,
  DesignMdAdHocDialog,
} from "@/components/design-md";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Favicon } from "@/components/ui/favicon";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";
import { cn } from "@/lib/utils";
import { buildFaviconCandidates } from "@/lib/utils/url";

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

  const tooltipText = selection.custom
    ? t("tooltipCustom", {
        hostname: getHostname(selection.custom.sourceUrl),
      })
    : defaultAttachment.owner.type === "organization"
      ? t("tooltip", { organization: defaultAttachment.owner.name })
      : t("tooltipPersonal");

  // The leading avatar doubles as a state readout: it always reflects whose
  // branding is currently selected, so swapping branding is visible at a
  // glance instead of only being spelled out in the label/action text.
  const avatar = selection.custom ? (
    <span className="bg-muted flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
      <Favicon
        sources={buildFaviconCandidates(selection.custom.sourceUrl)}
        alt=""
        size={20}
        className="rounded-full"
        fallback={
          <Globe className="text-muted-foreground size-3.5" aria-hidden />
        }
      />
    </span>
  ) : defaultAttachment.owner.type === "organization" ? (
    <Avatar className="size-6">
      {defaultAttachment.owner.logo ? (
        <AvatarImage
          src={defaultAttachment.owner.logo}
          alt=""
          className="object-cover"
        />
      ) : null}
      <AvatarFallback className="text-[0.625rem] font-medium">
        {defaultAttachment.owner.name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  ) : (
    <Avatar className="size-6">
      <AvatarFallback>
        <FileText className="text-muted-foreground size-3.5" aria-hidden />
      </AvatarFallback>
    </Avatar>
  );

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border p-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Checkbox
          id="task-design-md-attachment"
          checked={selection.enabled}
          onCheckedChange={(checked) =>
            onSelectionChange({ ...selection, enabled: checked === true })
          }
        />
        {avatar}
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
              className="text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-5 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2"
            >
              <Info className="size-3.5" aria-hidden />
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

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 text-xs"
        onClick={() => {
          if (selection.custom) {
            onSelectionChange({ ...selection, custom: null });
            return;
          }
          setIsAdHocDialogOpen(true);
        }}
      >
        <RefreshCw className="size-3.5" aria-hidden />
        {selection.custom ? t("resetToDefault") : t("useDifferentBranding")}
      </Button>

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
