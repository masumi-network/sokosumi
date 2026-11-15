"use client";

import { LayoutTemplate } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME } from "@/components/chat/room-message-composer";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { STUDIO_TEMPLATES, type StudioTemplate } from "./studio-templates";
import type { StudioLabels } from "./types";

type TemplatePickerProps = {
  labels: StudioLabels;
  onApplyTemplate: (template: StudioTemplate) => void;
};

function TemplateButton({
  template,
  label,
  onApplyTemplate,
}: {
  template: StudioTemplate;
  label: string;
  onApplyTemplate: TemplatePickerProps["onApplyTemplate"];
}) {
  return (
    <button
      className="bg-background hover:bg-accent focus-visible:ring-ring flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl p-1 pr-3 text-left transition-[background-color] outline-none select-none focus-visible:ring-2"
      onClick={() => onApplyTemplate(template)}
      type="button"
    >
      <span className="bg-muted relative size-8 shrink-0 overflow-hidden rounded-lg">
        <Image
          alt=""
          className="object-cover"
          decoding="async"
          fill
          loading="lazy"
          sizes="2rem"
          src={`/studio/templates/${template.id}.jpg`}
        />
      </span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

/**
 * The same starting briefs, one toolbar button away once there are results.
 *
 * A popover rather than a row above the composer: the row needed a horizontal
 * scrollbar, and it sat between the gallery and the prompt on every visit.
 * Picking one closes the menu and leaves the caret in the prompt.
 */
export function StudioTemplateMenu({
  labels,
  onApplyTemplate,
}: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const pickedRef = useRef(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
              size="icon"
              variant="ghost"
            >
              <LayoutTemplate aria-hidden />
              <span className="sr-only">{labels.templates}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{labels.templates}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        aria-label={labels.templates}
        className="app-scrollbar max-h-[min(28rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain p-2"
        onCloseAutoFocus={(event) => {
          if (!pickedRef.current) return;
          pickedRef.current = false;
          event.preventDefault();
        }}
      >
        <div className="grid grid-cols-2 gap-1" role="group">
          {STUDIO_TEMPLATES.map((template) => (
            <TemplateButton
              key={template.id}
              label={labels.templateLabels[template.id]}
              onApplyTemplate={(picked) => {
                pickedRef.current = true;
                setOpen(false);
                onApplyTemplate(picked);
              }}
              template={template}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
