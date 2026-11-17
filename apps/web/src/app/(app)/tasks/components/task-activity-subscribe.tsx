"use client";

import type { TaskParticipant } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TaskParticipantFace } from "@/app/tasks/components/task-participant-face";
import { READ_RECEIPT_FACE_CAP } from "@/components/chat/read-receipt-faces";
import { BotFace } from "@/components/soko-bot/bot-face";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  removeTaskParticipant,
  subscribeTaskParticipant,
} from "@/lib/actions/task/action";
import { unsubscribeTask } from "@/lib/actions/task/subscription-action";
import {
  FOLLOW_AFTER_SETUP_PARAM,
  taskFollowSetupPath,
} from "@/lib/workspace-gate";

/**
 * The Task this tab started setup for. A `?follow=1` link alone follows
 * nothing: only a setup started here by a click does.
 */
const FOLLOW_AFTER_SETUP_SESSION_KEY = "sokosumi.tasks.followAfterSetup";

function rememberFollowAfterSetup(taskId: string) {
  try {
    window.sessionStorage.setItem(FOLLOW_AFTER_SETUP_SESSION_KEY, taskId);
  } catch {
    // No storage: the return asks for one more click.
  }
}

/** Reads and clears the stored Task, so it is used at most once. */
function takeFollowAfterSetup(): string | null {
  try {
    const taskId = window.sessionStorage.getItem(
      FOLLOW_AFTER_SETUP_SESSION_KEY,
    );
    window.sessionStorage.removeItem(FOLLOW_AFTER_SETUP_SESSION_KEY);
    return taskId;
  } catch {
    return null;
  }
}

const BUTTON_CLASS = "text-muted-foreground h-7 px-2 text-xs font-medium";

/** What draws the viewer's own Soko Bot on the follow button. */
export interface ViewerSokoBotFace {
  imageUrl: string | null;
  avatarCode: string | null;
  seed: string;
}

export interface TaskActivitySubscribeControlProps {
  taskId: string;
  viewerId: string | null;
  viewerName: string | null;
  viewerImage: string | null;
  /** The viewer's personal Soko Bot in this workspace; null for none. */
  viewerSokoBot: ViewerSokoBotFace | null;
  participants: TaskParticipant[];
  /** Comment gate. Follow is hidden when false and the viewer is not a participant. */
  canComment: boolean;
}

export function TaskActivitySubscribeControl({
  taskId,
  viewerId,
  viewerName,
  viewerImage,
  viewerSokoBot,
  participants,
  canComment,
}: TaskActivitySubscribeControlProps) {
  const viewerHasSokoBot = viewerSokoBot !== null;
  const t = useTranslations("App.Tasks.Detail");
  const [followMarker, setFollowMarker] = useQueryState(
    FOLLOW_AFTER_SETUP_PARAM,
  );
  const [isPending, startTransition] = useTransition();
  // Committed state, not `useOptimistic`. An optimistic value is discarded
  // when the async transition ends and falls back to `participants` until
  // the action's own render lands — so the button briefly snaps back.
  const [visibleParticipants, setVisibleParticipants] = useState(participants);
  const [serverParticipants, setServerParticipants] = useState(participants);
  // A refresh while an action runs would undo the change on screen: the new
  // list is taken once the action settles.
  if (serverParticipants !== participants && !isPending) {
    setServerParticipants(participants);
    setVisibleParticipants(participants);
  }

  const viewerRow = visibleParticipants.find(
    (participant) => participant.user.id === viewerId,
  );
  const following = viewerRow?.subscribedAt != null;
  // Following needs comment access, as Core does; stopping never does.
  const canFollow = viewerId != null && canComment;
  const returnedFromSetup = followMarker === "1";
  // An archived bot: the follow stays, but messages go to the bell.
  const followArm =
    following && viewerHasSokoBot
      ? "active"
      : canFollow && viewerHasSokoBot
        ? "add"
        : canFollow || following
          ? "setup"
          : null;

  if (followArm === null && visibleParticipants.length === 0) {
    return null;
  }

  const faces = visibleParticipants.slice(0, READ_RECEIPT_FACE_CAP);
  const remainingCount = visibleParticipants.length - faces.length;

  function run(
    next: TaskParticipant[],
    action: () => Promise<{ ok: boolean }>,
    errorKey: string,
  ) {
    const previous = visibleParticipants;
    setVisibleParticipants(next);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        // A refresh held back while pending replaces this on the next render.
        setVisibleParticipants(previous);
        toast.error(t(errorKey));
      }
    });
  }

  function follow() {
    if (!viewerId) return;
    const now = new Date();
    const next = viewerRow
      ? visibleParticipants.map((participant) =>
          participant === viewerRow
            ? { ...participant, subscribedAt: now }
            : participant,
        )
      : [
          ...visibleParticipants,
          {
            user: {
              id: viewerId,
              name: viewerName ?? viewerId,
              image: viewerImage,
            },
            addedAt: now,
            subscribedAt: now,
            // The server decides the bot mark; the response replaces this row.
            followsWithSokoBot: false,
          },
        ];
    run(next, () => subscribeTaskParticipant({ taskId }), "followError");
  }

  function unfollow() {
    run(
      visibleParticipants.map((participant) =>
        participant === viewerRow
          ? { ...participant, subscribedAt: null, followsWithSokoBot: false }
          : participant,
      ),
      () => unsubscribeTask({ taskId }),
      "unfollowError",
    );
  }

  function leave() {
    run(
      visibleParticipants.filter((participant) => participant !== viewerRow),
      () => removeTaskParticipant({ taskId }),
      "removeParticipantError",
    );
  }

  function resumeAfterSetup() {
    // No follow offered yet: a copy of this page rendered before the bot
    // existed, or a read failed for a moment. Keep the hand-off for the
    // render that offers it.
    if (followArm !== "add" && followArm !== "active") return;
    // Read once: the marker and the stored Task are gone after this, so no
    // later visit or reload follows without a click.
    void setFollowMarker(null);
    const startedHere = takeFollowAfterSetup() === taskId;
    if (startedHere && followArm === "add") follow();
  }

  return (
    <div className="flex items-center gap-2">
      {returnedFromSetup ? (
        // Keyed: a fresh render that now shows the bot runs it again.
        <OnMount key={followArm} run={resumeAfterSetup} />
      ) : null}
      {followArm === null ? null : followArm === "active" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={BUTTON_CLASS}
          title={t("unfollow")}
          // The visible label is a state; the name also says what a press does.
          aria-label={`${t("followActive")}. ${t("unfollow")}`}
          loading={isPending}
          onClick={unfollow}
        >
          {viewerSokoBot ? <SokoBotMark face={viewerSokoBot} /> : null}
          {t("followActive")}
        </Button>
      ) : followArm === "add" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={BUTTON_CLASS}
          loading={isPending}
          onClick={follow}
        >
          {viewerSokoBot ? <SokoBotMark face={viewerSokoBot} /> : null}
          {t("followAdd")}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className={BUTTON_CLASS} asChild>
          <Link
            href={taskFollowSetupPath(taskId)}
            onClick={(event) => {
              // A new tab or window does not share this tab's storage.
              if (
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                rememberFollowAfterSetup(taskId);
              }
            }}
          >
            {t("followSetup")}
          </Link>
        </Button>
      )}

      {visibleParticipants.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center rounded-full focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
              aria-label={t("participantsList")}
            >
              <span className="flex -space-x-1.5">
                {faces.map((participant, index) => (
                  <span
                    key={participant.user.id}
                    data-testid={`task-subscribe-face-${participant.user.id}`}
                    className="ring-background relative inline-flex rounded-full ring-2"
                    style={{ zIndex: faces.length - index }}
                  >
                    <TaskParticipantFace participant={participant} />
                  </span>
                ))}
                {remainingCount > 0 ? (
                  <span
                    data-testid="task-subscribe-face-remainder"
                    className="bg-muted text-muted-foreground ring-background relative inline-flex size-5 items-center justify-center rounded-full text-2xs font-medium tabular-nums ring-2"
                    style={{ zIndex: 0 }}
                    aria-hidden
                  >
                    +{remainingCount}
                  </span>
                ) : null}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {visibleParticipants.map((participant) => (
              <DropdownMenuItem
                key={participant.user.id}
                className="flex items-center gap-2"
              >
                <TaskParticipantFace participant={participant} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {participant.user.name}
                </span>
                {participant.followsWithSokoBot ? (
                  <span className="text-muted-foreground text-xs">
                    {t("followsWithSokoBot")}
                  </span>
                ) : null}
              </DropdownMenuItem>
            ))}
            {viewerRow ? (
              <DropdownMenuItem disabled={isPending} onSelect={leave}>
                {t("leaveTask")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/** The viewer's bot, small, beside the follow label; decorative. */
function SokoBotMark({ face }: { face: ViewerSokoBotFace }) {
  return (
    <BotFace
      imageUrl={face.imageUrl}
      seed={face.seed}
      avatarCode={face.avatarCode}
      orbSize={32}
      avatarSize={16}
      className="size-4"
    />
  );
}

/**
 * Runs once when mounted; mounted only while the setup marker is present.
 * Strict mode runs it twice in development: the stored Task is read once,
 * so the second run follows nothing.
 */
function OnMount({ run }: { run: () => void }) {
  useMountEffect(run);
  return null;
}
