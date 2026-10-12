"use client";

import type { ChatRoomMessageSkill } from "@sokosumi/core-client";
import { ExternalLink, ScrollText } from "lucide-react";
import { useTranslations } from "next-intl";

import { ChipRemoveButton } from "@/components/ui/chip-remove-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const CHIP_CLASSNAME =
  "border-border bg-card-background text-foreground inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs font-medium";

/** A skill attached to a sent message; opens a short preview. */
export function MessageSkillChip({ skill }: { skill: ChatRoomMessageSkill }) {
  const t = useTranslations("App.Channels.Skills");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            CHIP_CLASSNAME,
            "hover:bg-muted focus-visible:ring-ring outline-none focus-visible:ring-2",
          )}
          aria-label={t("chipLabel", { name: skill.name })}
        >
          <ScrollText
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
          <span className="truncate">{skill.name}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-3">
        <p className="text-muted-foreground text-xs">{t("previewKicker")}</p>
        <p className="text-foreground mt-1 text-sm font-medium">{skill.name}</p>
        {skill.description ? (
          <p className="text-muted-foreground mt-1 text-xs">
            {skill.description}
          </p>
        ) : null}
        <a
          href={skill.url}
          target="_blank"
          rel="noreferrer"
          className="text-foreground mt-3 inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
        >
          {t("viewOnSkillsSh")}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </PopoverContent>
    </Popover>
  );
}

export function MessageSkillChips({
  skills,
}: {
  skills: readonly ChatRoomMessageSkill[] | undefined;
}) {
  if (!skills?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5" data-testid="message-skills">
      {skills.map((skill) => (
        <MessageSkillChip key={skill.id} skill={skill} />
      ))}
    </div>
  );
}

/** The composer's chips for skills picked for the next message. */
export function ComposerSkillChips({
  skills,
  onRemove,
}: {
  skills: readonly ChatRoomMessageSkill[];
  onRemove: (skill: ChatRoomMessageSkill) => void;
}) {
  const t = useTranslations("App.Channels.Skills");
  if (skills.length === 0) return null;
  return (
    <div
      className="flex flex-wrap gap-1.5 px-4 pt-3"
      data-testid="composer-skills"
    >
      {skills.map((skill) => (
        <span key={skill.id} className={cn(CHIP_CLASSNAME, "h-auto pe-0")}>
          <ScrollText
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
          <span className="truncate" title={skill.description ?? undefined}>
            {skill.name}
          </span>
          <ChipRemoveButton
            onClick={() => onRemove(skill)}
            className="hover:bg-muted"
            aria-label={t("remove", { name: skill.name })}
          />
        </span>
      ))}
    </div>
  );
}
