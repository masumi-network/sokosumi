"use client";

import type {
  ChatMessageSignal,
  ChatRoomMessage,
  ChatSignalRoutingSuggestion,
  ChatSignalTag,
} from "@sokosumi/core-client";
import {
  chatMessageTextWithNames,
  chatRoomQuotePromptLine,
} from "@sokosumi/utils";
import {
  AlertTriangle,
  Ban,
  Bug,
  CalendarClock,
  CircleHelp,
  Flame,
  Gavel,
  ListChecks,
  Loader2,
  Megaphone,
  MessageSquareText,
  Tags,
  X,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import {
  type ReactNode,
  type RefObject,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  correctChatSignalTagAction,
  setChatSignalLoopAction,
  suggestChatCoworkersAction,
} from "@/app/chat/signal-actions";
import { CHAT_DECISIONS_PATH } from "@/app/chat/utils/chat-route-base";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import {
  CHAT_SIGNAL_TAG_ORDER,
  type ChatSignalChip,
  chatMessageSenderName,
  chipTags,
  signalChips,
} from "@/components/chat/signals/signal-chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { POPOVER_ROW_CLASS } from "@/components/ui/popover-row-classes";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/effects/use-media-query";
import { cn } from "@/lib/utils";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

const CHIP_ICONS: Record<ChatSignalChip, typeof Gavel> = {
  needsYou: CircleHelp,
  escalation: AlertTriangle,
  urgent: Flame,
  blocker: Ban,
  decisionMade: Gavel,
  announcement: Megaphone,
  needsDecision: CircleHelp,
  commitment: CalendarClock,
  workRequest: ListChecks,
  bug: Bug,
  review: MessageSquareText,
  question: CircleHelp,
  fyi: CircleHelp,
  chitChat: CircleHelp,
};

/** Only these two draw in colour: one is the reader, one is a customer. */
function chipTone(chip: ChatSignalChip): string {
  if (chip === "needsYou") return "bg-quinary text-foreground";
  if (chip === "escalation" || chip === "urgent")
    return "bg-muted text-destructive";
  return "bg-muted text-muted-foreground";
}

/** A chip's name; a dated commitment carries its day. */
function signalChipLabel(
  chip: ChatSignalChip,
  signal: Pick<ChatMessageSignal, "commitmentDueAt">,
  t: ReturnType<typeof useTranslations<"App.Channels.Signals">>,
  format: ReturnType<typeof useFormatter>,
): string {
  if (chip !== "commitment" || !signal.commitmentDueAt) {
    return t(`Chips.${chip}`);
  }
  return t("Chips.commitmentDue", {
    date: format.dateTime(signal.commitmentDueAt, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
  });
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
 * every reader. On a touch screen the whole chip is the target: a tap opens
 * its actions in a sheet, so a stray tap never removes a tag.
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
  const touch = useMediaQuery("(hover: none)");
  const [sheetChip, setSheetChip] = useState<ChatSignalChip | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Where focus goes when the sheet closes: the chip that opened it.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
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

  const chipLabel = (chip: ChatSignalChip) =>
    signalChipLabel(chip, signal, t, format);

  function taskPrompt(): string {
    const names = new Map(
      [...(usersById ?? new Map())].map(([id, user]) => [id, user.name]),
    );
    // The whole message: a Coworker that cannot read the chat works from
    // this text alone.
    const author = chatMessageSenderName(message);
    const text = [
      author ? t("taskFrom", { name: author }) : "",
      chatMessageTextWithNames(message.content, names),
      message.quote ? chatRoomQuotePromptLine(message.quote) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const due = signal?.commitmentDueAt
      ? `\n\n${t("taskDue", {
          date: format.dateTime(signal.commitmentDueAt, {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
        })}`
      : "";
    // Absolute, since a Coworker reading the Task is not inside the app.
    const source = new URL(
      chatRoomMessageHref(message.roomId, message.id),
      window.location.origin,
    );
    return `${text}${due}\n\n${t("taskSource")} ${source}`;
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
      ref={barRef}
      data-testid="message-signal-bar"
      className="mt-1 flex flex-wrap items-center gap-1"
    >
      {chips.map((chip) => (
        <SignalChip
          key={chip}
          chip={chip}
          label={chipLabel(chip)}
          touch={touch}
          disabled={isSaving}
          onOpen={(opener) => {
            openerRef.current = opener;
            setSheetChip(chip);
            setSheetOpen(true);
          }}
          onRemove={() => correct(chipTags(chip, signal), false)}
        />
      ))}
      <TagActionsSheet
        chip={sheetChip}
        labelFor={chipLabel}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        openerRef={openerRef}
        barRef={barRef}
        onRemove={(chip) => {
          setSheetOpen(false);
          correct(chipTags(chip, signal), false);
        }}
      />
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

/**
 * One chip. With a pointer its `×` removes the tag; on a touch screen the
 * whole chip opens the tag's actions instead, so a tap alone keeps it.
 */
function SignalChip({
  chip,
  label,
  touch,
  disabled,
  onOpen,
  onRemove,
}: {
  chip: ChatSignalChip;
  label: string;
  touch: boolean;
  disabled: boolean;
  onOpen: (opener: HTMLButtonElement) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const Icon = CHIP_ICONS[chip];
  const chipClass = cn(
    "group/chip inline-flex h-6 items-center gap-1 rounded-md ps-1.5 text-xs font-medium",
    chipTone(chip),
  );
  if (touch) {
    return (
      <button
        type="button"
        data-chip={chip}
        aria-haspopup="dialog"
        disabled={disabled}
        className={cn(chipClass, "press pe-1.5 disabled:opacity-50")}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <Icon className="size-3 shrink-0" aria-hidden />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <span data-chip={chip} className={cn(chipClass, "pe-0.5")}>
      <Icon className="size-3 shrink-0" aria-hidden />
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-label={t("removeTag", { tag: label })}
        title={t("removeTag", { tag: label })}
        className="hit-area hover:bg-background grid size-4 place-items-center rounded-sm opacity-60 hover:opacity-100 focus-visible:opacity-100"
        onClick={onRemove}
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

/** A touch chip's actions, in the same bottom sheet as a message's own. */
function TagActionsSheet({
  chip,
  labelFor,
  open,
  onOpenChange,
  openerRef,
  barRef,
  onRemove,
}: {
  /** Null until a chip is tapped; it stays set while the sheet closes. */
  chip: ChatSignalChip | null;
  labelFor: (chip: ChatSignalChip) => string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chip that opened the sheet, where focus returns. */
  openerRef: RefObject<HTMLButtonElement | null>;
  /** The bar, whose tag button takes focus when the chip is removed. */
  barRef: RefObject<HTMLDivElement | null>;
  onRemove: (chip: ChatSignalChip) => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const tChannels = useTranslations("App.Channels");
  const removed = useRef(false);
  if (!chip) return null;

  function returnFocus(event: Event) {
    event.preventDefault();
    const target = removed.current
      ? barRef.current?.querySelector<HTMLElement>(
          "[data-testid=message-signal-edit]",
        )
      : openerRef.current;
    removed.current = false;
    target?.focus();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        onCloseAutoFocus={returnFocus}
        className="gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="items-center gap-2 pt-5 pb-3">
          <SheetTitle>{t("tagSheetTitle", { tag: labelFor(chip) })}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("editTagsNote")}
          </SheetDescription>
        </SheetHeader>
        <div className="border-border flex flex-col gap-1 border-t px-2 py-2">
          {chip === "decisionMade" ? (
            <Button
              asChild
              variant="ghost"
              className="h-11 justify-start gap-3 px-3"
            >
              <Link
                href={CHAT_DECISIONS_PATH}
                onClick={() => onOpenChange(false)}
              >
                <Gavel className="size-4 shrink-0" aria-hidden />
                {t("openInDecisions")}
              </Link>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive h-11 justify-start gap-3 px-3"
            onClick={() => {
              removed.current = true;
              onRemove(chip);
            }}
          >
            <X className="size-4 shrink-0" aria-hidden />
            {t("removeTagAction")}
          </Button>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-11 justify-center px-3"
            >
              {tChannels("Actions.cancel")}
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
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
      className="text-foreground h-6 rounded-md px-1.5 text-xs font-medium underline underline-offset-4"
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
        <ul className="-mx-2 flex flex-col">
          {CHAT_SIGNAL_TAG_ORDER.map((tag) => {
            const applies = signal.tags.includes(tag);
            const probability = signal.probabilities[tag];
            return (
              <li key={tag}>
                <label
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 text-sm",
                    !disabled && cn(POPOVER_ROW_CLASS, "cursor-pointer"),
                  )}
                >
                  <Checkbox
                    checked={applies}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      onToggle(tag, checked === true)
                    }
                  />
                  <span className="flex-1">{t(`Tags.${tag}`)}</span>
                  {probability != null ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {format.number(probability, { style: "percent" })}
                    </span>
                  ) : null}
                </label>
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
          className="text-foreground h-6 rounded-md px-1.5 text-xs font-medium underline underline-offset-4"
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
                  className={cn(
                    POPOVER_ROW_CLASS,
                    "flex w-full items-center gap-2 px-2 py-1.5 text-start",
                  )}
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
                className={cn(
                  POPOVER_ROW_CLASS,
                  "text-foreground w-full px-2 py-1.5 text-start text-sm font-medium",
                )}
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
