"use client";
import type {
  FundraisingProspect,
  FundraisingStage,
  Member,
} from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { PersonAvatar } from "@/app/contacts/components/contact-visuals";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FUNDRAISING_STAGES } from "../fundraising-view";

const NOBODY = "__nobody__";
/** A quiet trigger: reads as text until hovered, so a dense row stays calm. */
const TRIGGER =
  "w-auto min-w-0 gap-1 border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-quaternary dark:bg-transparent data-[state=open]:bg-quaternary";

export function StageSelect({
  value,
  onChange,
  className,
}: {
  value: FundraisingStage;
  onChange: (stage: FundraisingStage) => void;
  className?: string;
}) {
  const t = useTranslations("App.Fundraising");
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const stage = FUNDRAISING_STAGES.find((s) => s === next);
        if (stage && stage !== value) onChange(stage);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("columns.stage")}
        className={cn(TRIGGER, className)}
      >
        <span className="truncate">{t(`stages.${value}`)}</span>
      </SelectTrigger>
      <SelectContent align="start">
        {FUNDRAISING_STAGES.map((stage) => (
          <SelectItem key={stage} value={stage} className="text-xs">
            {t(`stages.${stage}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function OwnerSelect({
  owner,
  members,
  onChange,
  className,
}: {
  owner: FundraisingProspect["owner"];
  members: Member[];
  onChange: (userId: string | null) => void;
  className?: string;
}) {
  const t = useTranslations("App.Fundraising");
  return (
    <Select
      value={owner?.id ?? NOBODY}
      onValueChange={(next) => {
        const userId = next === NOBODY ? null : next;
        if (userId !== (owner?.id ?? null)) onChange(userId);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("columns.owner")}
        className={cn(TRIGGER, !owner && "text-muted-foreground", className)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {owner ? <PersonAvatar person={owner} /> : null}
          <span className="truncate">{owner?.name ?? t("unassigned")}</span>
        </span>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={NOBODY} className="text-xs">
          {t("unassigned")}
        </SelectItem>
        {members.map((member) => (
          <SelectItem
            key={member.user.id}
            value={member.user.id}
            className="text-xs"
          >
            <span className="flex items-center gap-1.5">
              <PersonAvatar person={member.user} />
              {member.user.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
