"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";

import {
  BRIEFING_CHIP_IDS,
  BRIEFING_WORD_TARGET,
  type BriefingChipId,
  countBriefingWords,
  insertBriefingHeading,
  PROJECT_BRIEFING_MAX_LENGTH,
} from "@/app/projects/project-briefing";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ProjectBriefingFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function ProjectBriefingField({
  id = "project-briefing",
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  className,
}: ProjectBriefingFieldProps) {
  const t = useTranslations("App.Projects.Briefing");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wordCount = countBriefingWords(value);
  const targetMet = wordCount >= BRIEFING_WORD_TARGET;

  function handleChipClick(chipId: BriefingChipId) {
    const next = insertBriefingHeading(value, t(`chips.${chipId}`));
    onChange(next);
    // Hand focus back to the textarea with the caret at the end so the user
    // can keep typing under the freshly inserted heading.
    const textarea = textareaRef.current;
    if (textarea) {
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(next.length, next.length);
      });
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{t("label")}</Label>
        <p
          className="text-muted-foreground font-mono text-xs tabular-nums"
          data-testid="briefing-word-count"
        >
          {t("wordCount", { count: wordCount })}
        </p>
      </div>

      <p className="text-muted-foreground text-sm leading-relaxed">
        {t("guidance")}
      </p>

      <div className="flex flex-wrap gap-2">
        {BRIEFING_CHIP_IDS.map((chipId) => (
          <button
            key={chipId}
            type="button"
            data-testid={`briefing-chip-${chipId}`}
            disabled={disabled}
            onClick={() => handleChipClick(chipId)}
            className="border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50"
          >
            {t(`chips.${chipId}`)}
          </button>
        ))}
      </div>

      <Textarea
        ref={textareaRef}
        id={id}
        maxLength={PROJECT_BRIEFING_MAX_LENGTH}
        placeholder={t("placeholder")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        className="min-h-48 flex-1 resize-none"
      />

      <p
        className={cn(
          "text-xs leading-relaxed",
          targetMet ? "text-muted-foreground" : "text-muted-foreground/70",
        )}
        data-testid="briefing-encouragement"
      >
        {targetMet ? t("encouragementMet") : t("encouragement")}
      </p>
    </div>
  );
}
