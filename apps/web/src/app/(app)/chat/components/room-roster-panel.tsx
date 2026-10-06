"use client";

import {
  Ellipsis,
  Loader2,
  LogOut,
  MessageCircle,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useFormatter } from "next-intl";
import type { RoomMemberReadState } from "@/app/chat/hooks/use-room-read-receipts";
import { AuroraOrb } from "@/components/aurora-orb";
import {
  LiveMemberPresenceDot,
  LiveMemberPresenceText,
} from "@/components/chat/live-member-presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyTextWithToast } from "@/hooks/use-clipboard";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import { groupRosterMembers } from "./group-roster-members";
import {
  canShowOpenDirect,
  participantDirectKey,
} from "./open-direct-with-participant";

import type { ChatParticipantHoverProfile } from "./room-helpers";

export const ROOM_ROSTER_PANEL_ID = "room-roster-panel";

export interface RoomRosterPanelLabels {
  title: string;
  /** Section heading over the people on the roster. */
  humansTitle: string;
  /** Section heading over the Coworkers and Soko Bots. */
  agentsTitle: string;
  /** Section heading over the external guests. */
  guestsTitle: string;
  /** "Read 2 minutes ago" for a member whose Room last-read is known. */
  readAt: (time: string) => string;
  /** For a member on the roster who has never opened the room. */
  notRead: string;
  close: string;
  empty: string;
  coworkerBadge: string;
  personalAssistantBadge?: string;
  message: (name: string) => string;
  copy: (value: string) => string;
  copySuccess: string;
  copyError: string;
  /** Header button that opens the add-members picker. */
  add: string;
  /** A row's overflow menu, e.g. "More actions for Ada". */
  memberActions: (name: string) => string;
  remove: string;
  leave: string;
}

/**
 * What the reader may change about the roster. Absent for a read-only roster:
 * a Direct, or a channel the reader can neither change nor leave.
 */
export interface RoomRosterManagement {
  /** Opens the add-members picker. Absent when the reader cannot add. */
  onAdd?: () => void;
  canRemove: (participant: ChatParticipantHoverProfile) => boolean;
  onRemove: (participant: ChatParticipantHoverProfile) => void;
  /** Leave the channel. Absent when the reader cannot leave. */
  onLeave?: () => void;
}

function rosterMemberCaption(
  participant: ChatParticipantHoverProfile,
): string | null {
  if (participant.kind === "human") {
    return participant.email || null;
  }
  if (participant.kind === "sokoBot") {
    return participant.caption;
  }
  return participant.slug ? `@${participant.slug}` : null;
}

function RosterMemberAvatar({
  participant,
}: {
  participant: ChatParticipantHoverProfile;
}) {
  const isAi =
    participant.kind === "coworker" || participant.kind === "sokoBot";
  return (
    <span className="relative inline-flex size-8 shrink-0">
      {participant.kind === "sokoBot" &&
      participant.avatarSeed &&
      !participant.image ? (
        <AuroraOrb
          seed={participant.avatarSeed}
          size={64}
          alt=""
          className="ring-border size-8 ring-1"
        />
      ) : (
        <Avatar className="size-8">
          <AvatarImage src={participant.image ?? undefined} alt="" />
          <AvatarFallback
            className={cn(
              "text-2xs",
              isAi
                ? "bg-primary-quinary text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {getInitials(participant.name)}
          </AvatarFallback>
        </Avatar>
      )}
      <LiveMemberPresenceDot
        className="absolute -right-0.5 -bottom-0.5"
        fallback={participant.presence}
        isCoworker={isAi}
        userId={participant.id}
      />
    </span>
  );
}

/**
 * Its own column rather than a third line: the name and the email already
 * stack in the row, and growing it for one member leaves the roster ragged.
 *
 * Its own component so a row without a mark never reaches for a formatter —
 * the read time is the only thing here that needs one.
 */
function RosterMemberReadState({
  readState,
  labels,
}: {
  readState: { kind: "read"; lastReadAt: Date };
  labels: RoomRosterPanelLabels;
}) {
  const format = useFormatter();
  const relative = format.relativeTime(readState.lastReadAt);

  return (
    <span
      // Under the name and the email rather than in a column beside them. On
      // the right it competed with the name for width, and a roster of twenty
      // truncated every name to "Alexa K…" to make room for a timestamp.
      className="text-muted-foreground max-w-full truncate text-xs leading-tight"
      data-testid="room-roster-read-state"
      title={labels.readAt(relative)}
    >
      {/* The column means one thing, so the interval carries it. The sentence
          stays for the tooltip and for anyone listening, because out of the
          column "vor 2 Stunden" says nothing about what happened then. */}
      <span aria-hidden>{relative}</span>
      <span className="sr-only">{labels.readAt(relative)}</span>
    </span>
  );
}

/** A row states a read time or nothing; never-read is said by its heading. */
function rowReadState(
  participant: ChatParticipantHoverProfile,
  readStateFor: (userId: string) => RoomMemberReadState | null,
): { kind: "read"; lastReadAt: Date } | null {
  if (participant.kind !== "human") {
    return null;
  }
  const state = readStateFor(participant.id);
  return state?.kind === "read" ? state : null;
}

function RosterMemberRow({
  participant,
  canMessage,
  isOpening,
  isDirectActionBusy,
  onOpenDirect,
  readState,
  onRemove,
  labels,
}: {
  participant: ChatParticipantHoverProfile;
  canMessage: boolean;
  isOpening: boolean;
  isDirectActionBusy: boolean;
  onOpenDirect: (profile: ChatParticipantHoverProfile) => void;
  /**
   * The member's Room last-read, when there is one to show. Never-read members
   * pass null: they sit under their own subheading, which says it once.
   */
  readState: { kind: "read"; lastReadAt: Date } | null;
  /** Remove this member from the channel; absent when the reader may not. */
  onRemove: (() => void) | null;
  labels: RoomRosterPanelLabels;
}) {
  const messageLabel = labels.message(participant.name);
  const caption = rosterMemberCaption(participant);
  const copyLabel = caption ? labels.copy(caption) : null;

  const nameBlock = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-medium">{participant.name}</span>
      {/* No "AI coworker" badge: the section heading above says it once, and
          repeating it on every row was a word per line for nothing. A Soko Bot
          keeps its badge — that one still distinguishes it from a Coworker
          inside the same section. */}
      {participant.kind === "sokoBot" && labels.personalAssistantBadge ? (
        <span className="text-muted-foreground shrink-0 text-xs">
          {labels.personalAssistantBadge}
        </span>
      ) : null}
    </span>
  );

  const messageIcon = isOpening ? (
    <Loader2
      className="text-muted-foreground size-4 shrink-0 animate-spin motion-reduce:animate-pulse"
      aria-hidden
    />
  ) : (
    <MessageCircle
      className="text-muted-foreground size-4 shrink-0 opacity-70 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
      data-testid="room-roster-message-icon"
      aria-hidden
    />
  );

  function handleOpenDirect() {
    onOpenDirect(participant);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        (canMessage || caption) && "press hover:bg-accent",
      )}
      data-testid="room-roster-member"
    >
      {canMessage ? (
        <button
          type="button"
          className="shrink-0 cursor-pointer"
          tabIndex={-1}
          aria-hidden
          disabled={isOpening || isDirectActionBusy}
          onClick={handleOpenDirect}
        >
          <RosterMemberAvatar participant={participant} />
        </button>
      ) : (
        <RosterMemberAvatar participant={participant} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {canMessage ? (
          <button
            type="button"
            className="min-w-0 cursor-pointer truncate text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={messageLabel}
            title={messageLabel}
            disabled={isOpening || isDirectActionBusy}
            onClick={handleOpenDirect}
          >
            {nameBlock}
          </button>
        ) : (
          nameBlock
        )}
        {/* Where the row is messageable the avatar button is aria-hidden and
            the name button sets its own aria-label, so neither can carry
            availability. Rendering it out here, clear of both, is what reaches
            assistive technology at all. One row is one person, so the state
            needs no name to attach to. */}
        <LiveMemberPresenceText
          className="sr-only"
          fallback={participant.presence}
          isCoworker={
            participant.kind === "coworker" || participant.kind === "sokoBot"
          }
          userId={participant.id}
        />
        {caption && copyLabel ? (
          <button
            type="button"
            className="text-muted-foreground press hover:text-foreground max-w-full cursor-pointer self-start truncate text-left text-xs leading-tight outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={copyLabel}
            title={copyLabel}
            onClick={() => {
              void copyTextWithToast(caption, {
                copySuccessMessage: labels.copySuccess,
                copyErrorMessage: labels.copyError,
              });
            }}
          >
            {caption}
          </button>
        ) : null}
        {readState ? (
          <RosterMemberReadState readState={readState} labels={labels} />
        ) : null}
      </div>
      {canMessage ? (
        <button
          type="button"
          className="shrink-0 cursor-pointer"
          tabIndex={-1}
          aria-hidden
          disabled={isOpening || isDirectActionBusy}
          onClick={handleOpenDirect}
        >
          {messageIcon}
        </button>
      ) : null}
      {onRemove ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 rounded-full lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:data-[state=open]:opacity-100"
              aria-label={labels.memberActions(participant.name)}
              title={labels.memberActions(participant.name)}
              data-testid="room-roster-member-actions"
            >
              <Ellipsis className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <UserMinus className="size-4" aria-hidden />
              {labels.remove}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

interface RoomRosterPanelProps {
  participants: ChatParticipantHoverProfile[];
  currentUserId: string;
  canOpenHumanDirect: boolean;
  onOpenDirect: (profile: ChatParticipantHoverProfile) => void;
  openingDirectKey: string | null;
  onClose: () => void;
  /** Seen by: what a row should say about a member, or null for silence. */
  readStateFor: (userId: string) => RoomMemberReadState | null;
  /** Ids of the external guests on the roster; they get their own section. */
  guestIds?: ReadonlySet<string>;
  management?: RoomRosterManagement;
  labels: RoomRosterPanelLabels;
}

export function RoomRosterPanel({
  participants,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirect,
  openingDirectKey,
  onClose,
  readStateFor,
  guestIds,
  management,
  labels,
}: RoomRosterPanelProps) {
  const { people, neverRead, guests, agents } = groupRosterMembers(
    participants,
    currentUserId,
    { readStateFor },
    guestIds,
  );
  // The count is every human on the roster, read or not — the heading answers
  // "how big is this room", not "how many have read".
  const humanCount = people.length + neverRead.length;
  const groups = [
    {
      key: "humans",
      heading: labels.humansTitle,
      count: humanCount,
      members: people,
      // Not a third kind of member alongside the machines: a division inside
      // the people, so it is a lighter mark than the headings around it.
      subgroup:
        neverRead.length > 0
          ? { heading: labels.notRead, members: neverRead }
          : null,
    },
    {
      key: "guests",
      heading: labels.guestsTitle,
      count: guests.length,
      members: guests,
      subgroup: null,
    },
    {
      key: "agents",
      heading: labels.agentsTitle,
      count: agents.length,
      members: agents,
      subgroup: null,
    },
  ] as const;
  // Only worth naming once two kinds are there. A room of people alone needs
  // no heading saying so.
  const showHeadings =
    [humanCount, guests.length, agents.length].filter((count) => count > 0)
      .length > 1;

  function rowRemoval(participant: ChatParticipantHoverProfile) {
    if (!management?.canRemove(participant)) {
      return null;
    }
    return () => management.onRemove(participant);
  }

  return (
    <aside
      className="bg-background absolute inset-0 z-30 flex min-h-0 w-full shrink-0 flex-col lg:static lg:z-auto lg:w-80 lg:border-l"
      id={ROOM_ROSTER_PANEL_ID}
      data-testid="room-roster-panel"
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h2 className="truncate text-sm font-semibold">{labels.title}</h2>
        <div className="flex shrink-0 items-center gap-1">
          {management?.onAdd ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-full"
              aria-label={labels.add}
              title={labels.add}
              data-testid="room-roster-add"
              onClick={management.onAdd}
            >
              <UserPlus className="size-4" aria-hidden />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            aria-label={labels.close}
            title={labels.close}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </header>
      <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto p-1">
        {participants.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.empty}
          </p>
        ) : (
          groups.map(({ key, heading, count, members, subgroup }) =>
            members.length === 0 && !subgroup ? null : (
              <section key={key} className="mb-1">
                {showHeadings ? (
                  <h3
                    className="text-muted-foreground flex items-baseline gap-1.5 px-2 pt-2 pb-1 text-xs font-medium"
                    data-testid={`room-roster-section-${key}`}
                  >
                    {heading}
                    <span className="text-muted-foreground tabular-nums">
                      {count}
                    </span>
                  </h3>
                ) : null}
                {members.map((participant) => (
                  <RosterMemberRow
                    key={`${participant.kind}-${participant.id}`}
                    participant={participant}
                    canMessage={canShowOpenDirect({
                      profile: participant,
                      currentUserId,
                      canOpenHumanDirect,
                      onOpenDirect,
                    })}
                    isOpening={
                      openingDirectKey === participantDirectKey(participant)
                    }
                    isDirectActionBusy={openingDirectKey != null}
                    onOpenDirect={onOpenDirect}
                    readState={rowReadState(participant, readStateFor)}
                    onRemove={rowRemoval(participant)}
                    labels={labels}
                  />
                ))}
                {subgroup ? (
                  <>
                    <h4
                      className="text-muted-foreground flex items-baseline gap-1.5 px-2 pt-3 pb-1 text-2xs font-medium"
                      data-testid="room-roster-subsection-never-read"
                    >
                      {subgroup.heading}
                      <span className="tabular-nums">
                        {subgroup.members.length}
                      </span>
                    </h4>
                    {subgroup.members.map((participant) => (
                      <RosterMemberRow
                        key={`${participant.kind}-${participant.id}`}
                        participant={participant}
                        canMessage={canShowOpenDirect({
                          profile: participant,
                          currentUserId,
                          canOpenHumanDirect,
                          onOpenDirect,
                        })}
                        isOpening={
                          openingDirectKey === participantDirectKey(participant)
                        }
                        isDirectActionBusy={openingDirectKey != null}
                        onOpenDirect={onOpenDirect}
                        // The subheading above already said it.
                        readState={null}
                        onRemove={rowRemoval(participant)}
                        labels={labels}
                      />
                    ))}
                  </>
                ) : null}
              </section>
            ),
          )
        )}
      </div>
      {management?.onLeave ? (
        <footer className="shrink-0 border-t p-2">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={management.onLeave}
          >
            <LogOut className="size-4" aria-hidden />
            {labels.leave}
          </Button>
        </footer>
      ) : null}
    </aside>
  );
}
