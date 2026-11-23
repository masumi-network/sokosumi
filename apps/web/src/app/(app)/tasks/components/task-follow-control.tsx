"use client";

import type { TaskFollower } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { READ_RECEIPT_FACE_CAP } from "@/components/chat/read-receipt-faces";
import { BotFace } from "@/components/soko-bot/bot-face";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { followTask, unfollowTask } from "@/lib/actions/task/follow-action";
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

export interface TaskFollowControlProps {
  taskId: string;
  viewerId: string | null;
  /** The viewer's personal Soko Bot in this workspace; null for none. */
  viewerSokoBot: ViewerSokoBotFace | null;
  followers: TaskFollower[];
  /** Comment gate. Follow is hidden when false and the viewer does not follow. */
  canComment: boolean;
}

/**
 * Follow the Task with your Soko Bot: it posts the Task's updates in your
 * chat with it. Separate from taking part: following never adds you to the
 * participants. Beside it, the faces of the other people who follow.
 */
export function TaskFollowControl({
  taskId,
  viewerId,
  viewerSokoBot,
  followers,
  canComment,
}: TaskFollowControlProps) {
  const viewerHasSokoBot = viewerSokoBot !== null;
  const t = useTranslations("App.Tasks.Detail");
  const [followMarker, setFollowMarker] = useQueryState(
    FOLLOW_AFTER_SETUP_PARAM,
  );
  const [isPending, startTransition] = useTransition();
  const serverFollowing =
    viewerId != null && followers.some(({ user }) => user.id === viewerId);
  // Committed state, not `useOptimistic`: an optimistic value snaps back
  // when the transition ends, before the action's own render lands.
  const [following, setFollowing] = useState(serverFollowing);
  const [lastServerFollowing, setLastServerFollowing] =
    useState(serverFollowing);
  // A refresh while an action runs would undo the change on screen: the new
  // value is taken once the action settles.
  if (lastServerFollowing !== serverFollowing && !isPending) {
    setLastServerFollowing(serverFollowing);
    setFollowing(serverFollowing);
  }

  // Following needs comment access, as Core does; stopping never does.
  const canFollow = viewerId != null && canComment;
  // A follower can always stop, even after archiving the bot: its moments
  // then go to the bell.
  const arm = following
    ? "active"
    : canFollow && viewerHasSokoBot
      ? "add"
      : canFollow
        ? "setup"
        : null;

  function run(next: boolean, action: () => Promise<{ ok: boolean }>) {
    setFollowing(next);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setFollowing(!next);
        toast.error(t(next ? "followError" : "unfollowError"));
      }
    });
  }

  function resumeAfterSetup() {
    // No follow offered yet: a copy of this page rendered before the bot
    // existed, or a read failed for a moment. Keep the hand-off for the
    // render that offers it.
    if (arm !== "add" && arm !== "active") return;
    // Read once: the marker and the stored Task are gone after this, so no
    // later visit or reload follows without a click.
    void setFollowMarker(null);
    const startedHere = takeFollowAfterSetup() === taskId;
    if (startedHere && arm === "add") run(true, () => followTask({ taskId }));
  }

  const others = followers.filter(({ user }) => user.id !== viewerId);
  if (arm === null && others.length === 0) return null;
  const faces = others.slice(0, READ_RECEIPT_FACE_CAP);
  const remainingCount = others.length - faces.length;
  const overflowNames = others
    .slice(faces.length)
    .map(({ user }) => user.name)
    .join(", ");

  return (
    <div className="flex items-center gap-2">
      {followMarker === "1" ? (
        // Keyed: a fresh render that now shows the bot runs it again.
        <OnMount key={arm ?? "none"} run={resumeAfterSetup} />
      ) : null}
      {arm === "active" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={BUTTON_CLASS}
          title={t("unfollow")}
          // The visible label is a state; the name also says what a press does.
          aria-label={`${t("followActive")}. ${t("unfollow")}`}
          loading={isPending}
          onClick={() => run(false, () => unfollowTask({ taskId }))}
        >
          {viewerSokoBot ? <SokoBotMark face={viewerSokoBot} /> : null}
          {t("followActive")}
        </Button>
      ) : arm === "add" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={BUTTON_CLASS}
          loading={isPending}
          onClick={() => run(true, () => followTask({ taskId }))}
        >
          {viewerSokoBot ? <SokoBotMark face={viewerSokoBot} /> : null}
          {t("follow")}
        </Button>
      ) : arm === "setup" ? (
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
            {t("follow")}
          </Link>
        </Button>
      ) : null}
      {faces.length > 0 ? (
        <span
          className="flex -space-x-1.5"
          role="group"
          aria-label={t("followedBy")}
        >
          {faces.map(({ user }, index) => (
            <Tooltip key={user.id}>
              <TooltipTrigger asChild>
                {/* Focusable, so a keyboard also opens the name. An image
                    role names it once; the avatar's own alt is not read. */}
                <span
                  data-testid={`task-follower-face-${user.id}`}
                  role="img"
                  aria-label={user.name}
                  tabIndex={0}
                  className="ring-background focus-visible:ring-ring relative inline-flex rounded-full ring-2 outline-hidden focus-visible:z-10!"
                  style={{ zIndex: faces.length - index }}
                >
                  <AssigneeAvatar
                    assignee={{ ...user, kind: "user" }}
                    size="sm"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>{user.name}</TooltipContent>
            </Tooltip>
          ))}
          {remainingCount > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  data-testid="task-follower-overflow"
                  className="bg-muted text-muted-foreground ring-background focus-visible:ring-ring relative inline-flex size-5 items-center justify-center rounded-full text-2xs font-medium tabular-nums ring-2 outline-hidden focus-visible:z-10!"
                  style={{ zIndex: 0 }}
                  role="img"
                  aria-label={t("moreFollowers", {
                    count: remainingCount,
                    names: overflowNames,
                  })}
                  tabIndex={0}
                >
                  +{remainingCount}
                </span>
              </TooltipTrigger>
              <TooltipContent>{overflowNames}</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** The viewer's own bot, small, beside the follow label; decorative. */
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
  useEffect(run, []);
  return null;
}
