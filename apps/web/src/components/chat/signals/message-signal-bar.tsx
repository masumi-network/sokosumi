"use client";

import type {
  ChatMessageSignal,
  ChatRoomMessage,
  ChatSignalRoutingSuggestion,
  ChatSignalTag,
} from "@sokosumi/core-client";
import { buildChatMessagePreview } from "@sokosumi/utils";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CircleHelp,
  Flame,
  Gavel,
  ListChecks,
  Loader2,
  Tags,
  X,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  correctChatSignalTagAction,
  setChatSignalLoopAction,
  suggestChatCoworkersAction,
} from "@/app/chat/signal-actions";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import {
  CHAT_SIGNAL_TAG_ORDER,
  type ChatSignalChip,
  chipTags,
  signalChips,
} from "@/components/chat/signals/signal-chips";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

const CHIP_ICONS: Record<ChatSignalChip, typeof Gavel> = {
  needsYou: CircleHelp,
  escalation: AlertTriangle,
  urgent: Flame,
  blocker: Ban,
  decisionMade: Gavel,
  needsDecision: CircleHelp,
  commitment: CalendarClock,
  workRequest: ListChecks,
  question: CircleHelp,
  fyi: CircleHelp,
  chitChat: CircleHelp,
};

/** Only these two draw in colour: one is the reader, one is a customer. */
function chipTone(chip: ChatSignalChip): string {
  if (chip === "needsYou") return "bg-primary-quaternary text-primary-variant";
  if (chip === "escalation" || chip === "urgent")
    return "bg-muted text-destructive";
  return "bg-muted text-muted-foreground";
}

interface MessageSignalBarProps {
  message: ChatRoomMessage;
  currentUserId?: string;
  /** The room's people, so a task description reads mentions as names. */
  usersById?: ReadonlyMap<string, { name: string }>;
}

/**
 * What Jev read in a message, under it: a few calm chips, and the one or two
 * things a reader can do about it (make a Task of a commitment, hand a work
 * request to a Coworker). A guide, not a verdict: one click on a chip's `×`
 * removes it, and the tag button edits every tag. Corrections apply for
 * every reader.
 */
export function MessageSignalBar({
  message,
  currentUserId,
  usersById,
}: MessageSignalBarProps) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  // The answer to a correction, until the room's next read brings it.
  const [override, setOverride] = useState<ChatMessageSignal | null>(null);
  const [isSaving, startSaving] = useTransition();
  const wizard = useOptionalNewTaskWizard();
  const signal = override ?? message.signal ?? null;
  if (!signal) return null;
  const chips = signalChips(signal, currentUserId);
  const loopClosed = signal.loopClosedAt != null;
  const offersTask = signal.tags.includes("commitment") && !loopClosed;
  const offersHandOff = signal.tags.includes("workRequest") && !loopClosed;
  if (chips.length === 0 && !loopClosed) return null;

  function applyResult(
    result: Awaited<ReturnType<typeof correctChatSignalTagAction>>,
  ) {
    if (!result.ok) {
      toast.error(t("error"));
      return;
    }
    setOverride(result.value.signal ?? null);
  }

  function correct(tags: readonly ChatSignalTag[], applies: boolean) {
    startSaving(async () => {
      for (const tag of tags) {
        applyResult(await correctChatSignalTagAction(message.id, tag, applies));
      }
    });
  }

  function taskPrompt(): string {
    const names = new Map(
      [...(usersById ?? new Map())].map(([id, user]) => [id, user.name]),
    );
    const text = buildChatMessagePreview(message.content, names);
    const due = signal?.commitmentDueAt
      ? `\n\n${t("taskDue", {
          date: format.dateTime(signal.commitmentDueAt, {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
        })}`
      : "";
    return `${text}${due}\n\n${t("taskSource")} ${chatRoomMessageHref(message.roomId, message.id)}`;
  }

  function openTask(assigneeId?: string) {
    if (!wizard) return;
    wizard.openNewTaskWizard({
      prompt: taskPrompt(),
      assigneeId: assigneeId ?? null,
      onTaskCreated: (taskId) => {
        void setChatSignalLoopAction(message.id, {
          closed: true,
          taskId,
        }).then(applyResult);
      },
    });
  }

  return (
    <div
      data-testid="message-signal-bar"
      className="mt-1 flex flex-wrap items-center gap-1"
    >
      {chips.map((chip) => {
        const Icon = CHIP_ICONS[chip];
        const label =
          chip === "commitment" && signal.commitmentDueAt
            ? t("Chips.commitmentDue", {
                date: format.dateTime(signal.commitmentDueAt, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                }),
              })
            : t(`Chips.${chip}`);
        return (
          <span
            key={chip}
            data-chip={chip}
            className={cn(
              "group/chip inline-flex h-6 items-center gap-1 rounded-md ps-1.5 pe-0.5 text-xs font-medium",
              chipTone(chip),
            )}
          >
            <Icon className="size-3 shrink-0" aria-hidden />
            <span>{label}</span>
            <button
              type="button"
              disabled={isSaving}
              aria-label={t("removeTag", { tag: label })}
              title={t("removeTag", { tag: label })}
              className="hit-area hover:bg-background grid size-4 place-items-center rounded-sm opacity-60 hover:opacity-100 focus-visible:opacity-100"
              onClick={() => correct(chipTags(chip, signal), false)}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        );
      })}
      {loopClosed ? (
        signal.loopTaskId ? (
          <Link
            href={`/tasks/${signal.loopTaskId}`}
            className="text-muted-foreground px-1 text-xs hover:underline"
          >
            {t("taskMade")}
          </Link>
        ) : (
          <span className="text-muted-foreground px-1 text-xs">
            {t("loopClosed")}
          </span>
        )
      ) : null}
      {offersTask && wizard ? (
        <TextAction
          onClick={() =>
            // Whoever made the commitment owns it.
            openTask(
              message.sender.type === "user"
                ? message.sender.user.id
                : undefined,
            )
          }
        >
          {t("makeTask")}
        </TextAction>
      ) : null}
      {offersHandOff && wizard ? (
        <HandOffPopover messageId={message.id} onPick={openTask} />
      ) : null}
      <TagEditor
        signal={signal}
        disabled={isSaving}
        onToggle={(tag, applies) => correct([tag], applies)}
      />
      {isSaving ? (
        <Loader2
          className="text-muted-foreground size-3 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

function TextAction({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-primary-variant h-6 rounded-md px-1.5 text-xs font-medium hover:underline"
    >
      {children}
    </button>
  );
}

/** The tag editor: every tag as a checkbox, with Jev's probability beside it. */
function TagEditor({
  signal,
  disabled,
  onToggle,
}: {
  signal: ChatMessageSignal;
  disabled: boolean;
  onToggle: (tag: ChatSignalTag, applies: boolean) => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("editTags")}
          title={t("editTags")}
          className="text-muted-foreground hover:text-foreground grid size-6 place-items-center rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
          data-testid="message-signal-edit"
        >
          <Tags className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <p className="mb-2 text-xs font-medium">{t("editTagsTitle")}</p>
        <ul className="flex flex-col gap-1.5">
          {CHAT_SIGNAL_TAG_ORDER.map((tag) => {
            const applies = signal.tags.includes(tag);
            const probability = signal.probabilities[tag];
            const id = `signal-${tag}`;
            return (
              <li key={tag} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={applies}
                  disabled={disabled}
                  onCheckedChange={(checked) => onToggle(tag, checked === true)}
                />
                <label htmlFor={id} className="flex-1 text-sm">
                  {t(`Tags.${tag}`)}
                </label>
                {probability != null ? (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {format.number(probability, { style: "percent" })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground mt-3 text-xs text-pretty">
          {t("editTagsNote")}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** A work request's hand-off: fitting Coworkers, read when it opens. */
function HandOffPopover({
  messageId,
  onPick,
}: {
  messageId: string;
  onPick: (coworkerId?: string) => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<
    ChatSignalRoutingSuggestion[] | null
  >(null);
  const [isLoading, startLoading] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && suggestions === null) {
      startLoading(async () => {
        const result = await suggestChatCoworkersAction(messageId);
        setSuggestions(result.ok ? result.value : []);
      });
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-primary-variant h-6 rounded-md px-1.5 text-xs font-medium hover:underline"
          data-testid="message-signal-hand-off"
        >
          {t("handOff")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        {isLoading || suggestions === null ? (
          <p className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-sm">
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            {t("findingCoworkers")}
          </p>
        ) : (
          <ul className="flex flex-col">
            {suggestions.map((suggestion) => (
              <li key={suggestion.coworkerId}>
                <button
                  type="button"
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start"
                  onClick={() => {
                    setOpen(false);
                    onPick(suggestion.coworkerId);
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {suggestion.name}
                    </span>
                    {suggestion.caption ? (
                      <span className="text-muted-foreground truncate text-xs">
                        {suggestion.caption}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {t("fit", {
                      fit: format.number(suggestion.fit, { style: "percent" }),
                    })}
                  </span>
                </button>
              </li>
            ))}
            {suggestions.length === 0 ? (
              <li className="text-muted-foreground px-2 py-1.5 text-sm">
                {t("noCoworkerFits")}
              </li>
            ) : null}
            <li>
              <button
                type="button"
                className="hover:bg-muted text-primary-variant w-full rounded-md px-2 py-1.5 text-start text-sm font-medium"
                onClick={() => {
                  setOpen(false);
                  onPick();
                }}
              >
                {t("createTask")}
              </button>
            </li>
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
