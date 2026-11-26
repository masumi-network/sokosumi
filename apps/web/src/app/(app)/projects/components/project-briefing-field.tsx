"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import {
  BRIEFING_CHIP_IDS,
  BRIEFING_WORD_TARGET,
  type BriefingChipId,
  type BriefingCopySource,
  countBriefingWords,
  insertBriefingHeading,
  PROJECT_BRIEFING_MAX_LENGTH,
} from "@/app/projects/project-briefing";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  /** Other projects in this workspace whose briefing can be copied in. */
  copySources?: BriefingCopySource[];
}

export function ProjectBriefingField({
  id = "project-briefing",
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  className,
  copySources = [],
}: ProjectBriefingFieldProps) {
  const t = useTranslations("App.Projects.Briefing");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The last copy, kept until the text changes again so Undo restores it.
  const [copied, setCopied] = useState<{
    name: string;
    previous: string;
  } | null>(null);
  const wordCount = countBriefingWords(value);
  const targetMet = wordCount >= BRIEFING_WORD_TARGET;

  function handleChipClick(chipId: BriefingChipId) {
    setCopied(null);
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

  // Fills the field only; nothing is saved until the form is submitted.
  function handleCopy(source: BriefingCopySource) {
    setCopied({ name: source.name, previous: value });
    onChange(source.briefing);
  }

  function handleUndo() {
    if (!copied) return;
    onChange(copied.previous);
    setCopied(null);
    textareaRef.current?.focus();
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor={id}>{t("label")}</Label>
          {copySources.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={disabled}>
                <Button type="button" variant="ghost" size="sm">
                  <Copy aria-hidden />
                  {t("copy.trigger")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-72 max-w-[calc(100vw-2rem)] overflow-y-auto"
              >
                {copySources.map((source) => (
                  <DropdownMenuItem
                    key={source.id}
                    onSelect={() => handleCopy(source)}
                  >
                    <span className="truncate">{source.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p
          className="text-muted-foreground font-mono text-xs tabular-nums"
          data-testid="briefing-word-count"
        >
          {t("wordCount", { count: wordCount })}
        </p>
      </div>

      {copySources.length > 0 ? (
        // Idle, the live region stays mounted but takes no room.
        <div className={copied ? "flex items-center gap-2" : "sr-only"}>
          <p
            role="status"
            className="flex min-w-0 items-center gap-1.5 text-sm"
          >
            {copied ? (
              <>
                <Check className="check-pop size-4 shrink-0" aria-hidden />
                {t("copy.copied", { name: copied.name })}
              </>
            ) : null}
          </p>
          {copied ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleUndo}
              disabled={disabled}
            >
              {t("copy.undo")}
            </Button>
          ) : null}
        </div>
      ) : null}

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
            className="border-border text-muted-foreground press hover:text-foreground hover:bg-card-background inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50"
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
        onChange={(event) => {
          setCopied(null);
          onChange(event.target.value);
        }}
        disabled={disabled}
        autoFocus={autoFocus}
        className="min-h-48 flex-1 resize-none"
      />

      <p
        // Both states read at one weight now. The unmet hint used to be a
        // /70 fade of this token, which is under the 4.5:1 floor, and there
        // is no legal step fainter than --muted-foreground to move it to.
        // The wording is what separates the two states.
        className="text-muted-foreground text-xs leading-relaxed"
        data-testid="briefing-encouragement"
      >
        {targetMet ? t("encouragementMet") : t("encouragement")}
      </p>
    </div>
  );
}
