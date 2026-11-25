"use client";

import { TaskPriority } from "@sokosumi/core-client";
import {
  CalendarClock,
  CalendarPlus,
  Check,
  Eye,
  LayoutTemplate,
  Lock,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import {
  OfferDetailDialog,
  type OutputKind,
} from "@/components/agents/offer-card";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { POPOVER_ROW_CLASS } from "@/components/ui/popover-row-classes";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CoworkerOffer, CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";
import { AssigneeAvatar } from "./task-assignee-picker";
import { COMPOSER_PILL_CLASS } from "./task-composer-pill";
import { TASK_PRIORITIES } from "./task-metadata-priority-field";
import { TaskPriorityIcon } from "./task-priority-icon";

export function PriorityPill({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (priority: TaskPriority) => void;
}) {
  const t = useTranslations("App.Tasks.Priority");
  const [open, setOpen] = useState(false);
  const isSet = value !== TaskPriority.NONE;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={`${t("title")}: ${t(`levels.${value}`)}`}
          data-filled={isSet}
          className={COMPOSER_PILL_CLASS}
        >
          <TaskPriorityIcon priority={value} />
          {isSet ? t(`levels.${value}`) : t("title")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput autoFocus hideIcon placeholder={t("change")} />
          <CommandList className="p-1">
            <CommandEmpty>{t("noResults")}</CommandEmpty>
            {TASK_PRIORITIES.map((level) => (
              <CommandItem
                key={level}
                value={level}
                keywords={[t(`levels.${level}`)]}
                data-current={level === value || undefined}
                onSelect={() => {
                  setOpen(false);
                  onChange(level);
                }}
              >
                <TaskPriorityIcon priority={level} />
                <span className="flex-1 truncate">{t(`levels.${level}`)}</span>
                {level === value ? (
                  <Check className="size-4" aria-hidden />
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** `YYYY-MM-DD` read as a calendar day, never shifted by the time zone. */
function dayFromIso(dueOn: string): Date {
  const [year, month, day] = dueOn.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function DueDatePill({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (dueOn: string | null) => void;
}) {
  const t = useTranslations("App.Tasks.Due");
  const format = useFormatter();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const shown = value
    ? format.dateTime(dayFromIso(value), { day: "numeric", month: "short" })
    : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!draft) return;
    onChange(draft);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value ?? "");
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={shown ? t("due", { date: shown }) : t("set")}
          data-filled={value !== null}
          className={COMPOSER_PILL_CLASS}
        >
          <CalendarPlus aria-hidden />
          {shown ?? t("label")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form onSubmit={handleSubmit} className="space-y-3">
          <label htmlFor={inputId} className="text-sm font-medium">
            {t("label")}
          </label>
          <Input
            id={inputId}
            type="date"
            required
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                {t("clear")}
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!draft}>
              {t("save")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Start time: only an agent can hold one, so it explains itself otherwise. */
export function StartTimePill({
  label,
  shownTime,
  enabled,
  disabledHint,
  onOpen,
}: {
  label: string;
  shownTime: string | null;
  enabled: boolean;
  disabledHint: string;
  onOpen: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={shownTime ? `${label}: ${shownTime}` : label}
          aria-pressed={shownTime !== null}
          aria-disabled={!enabled}
          data-filled={shownTime !== null}
          className={COMPOSER_PILL_CLASS}
          onClick={() => {
            if (enabled) onOpen();
          }}
        >
          <CalendarClock aria-hidden />
          <span className="truncate">{shownTime ?? label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-64">
        {enabled ? label : disabledHint}
      </TooltipContent>
    </Tooltip>
  );
}

export function PrivatePill({
  pressed,
  label,
  description,
  onPressedChange,
}: {
  pressed: boolean;
  label: string;
  description?: string;
  onPressedChange: (pressed: boolean) => void;
}) {
  const descriptionId = useId();
  const pill = (
    <button
      type="button"
      id="task-private"
      aria-label={label}
      aria-describedby={description ? descriptionId : undefined}
      aria-pressed={pressed}
      data-filled={pressed}
      className={cn(
        COMPOSER_PILL_CLASS,
        pressed && "bg-muted text-foreground border-transparent",
      )}
      onClick={() => onPressedChange(!pressed)}
    >
      <Lock aria-hidden />
      {label}
    </button>
  );
  if (!description) return pill;
  return (
    <>
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>{pill}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={6} className="max-w-72">
          {description}
        </TooltipContent>
      </Tooltip>
    </>
  );
}

/** The assignee's ready-made tasks: picking one fills the title and text. */
export function TemplatePill({
  assignee,
  onPick,
}: {
  assignee: CoworkerOption;
  onPick: (offer: CoworkerOffer) => void;
}) {
  const t = useTranslations("App.Tasks.Composer");
  const tGallery = useTranslations("App.Agents.CoworkerGallerySection");
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CoworkerOffer | null>(null);
  const offers = assignee.offers ?? [];
  if (offers.length === 0) return null;

  function pick(offer: CoworkerOffer) {
    setOpen(false);
    setPreview(null);
    onPick(offer);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("templates")}
                className="focus-visible:ring-ring text-muted-foreground press hover:bg-accent hover:text-accent-foreground hit-area inline-flex size-7 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2"
              >
                <LayoutTemplate className="size-4" aria-hidden />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {t("templatesFrom", { name: assignee.name })}
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="start" side="top" className="w-80 p-1">
          <p className="text-muted-foreground px-2 pt-1.5 pb-1 text-xs font-medium">
            {t("templatesFrom", { name: assignee.name })}
          </p>
          <ul>
            {offers.map((offer) => (
              <li key={offer.title} className="flex items-center gap-1">
                <button
                  type="button"
                  className={cn(
                    POPOVER_ROW_CLASS,
                    "min-w-0 flex-1 px-2 py-1.5 text-left text-sm",
                  )}
                  onClick={() => pick(offer)}
                >
                  <span className="block truncate">{offer.title}</span>
                  {offer.category ? (
                    <span className="text-muted-foreground block truncate text-xs">
                      {offer.category}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label={t("previewTemplate", { title: offer.title })}
                  className={cn(
                    POPOVER_ROW_CLASS,
                    "text-muted-foreground hover:text-foreground inline-flex size-8 shrink-0 items-center justify-center",
                  )}
                  onClick={() => {
                    setOpen(false);
                    setPreview(offer);
                  }}
                >
                  <Eye className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <OfferDetailDialog
        item={
          preview
            ? {
                offer: preview,
                coworkerName: assignee.name,
                coworkerCaption: assignee.caption ?? undefined,
                vendor: assignee.vendor,
                coworkerAvatar: <AssigneeAvatar option={assignee} />,
              }
            : null
        }
        onClose={() => setPreview(null)}
        onStart={() => {
          if (preview) pick(preview);
        }}
        labels={{
          deliveredBy: tGallery("deliveredByLabel"),
          deliverable: tGallery("deliverableLabel"),
          start: t("useTemplate"),
          pending: t("noExample"),
          openInNewTab: tGallery("openInNewTab"),
          fallbackTitle: tGallery("offerDetails"),
        }}
        typeLabel={(type: OutputKind) => tGallery(`outputTypes.${type}`)}
      />
    </>
  );
}
