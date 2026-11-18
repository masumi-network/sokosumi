"use client";

import type { TaskFollower } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
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

export interface TaskFollowControlProps {
  taskId: string;
  viewerId: string | null;
  /** The viewer has a personal Soko Bot in this workspace. */
  viewerHasSokoBot: boolean;
  followers: TaskFollower[];
  /** Comment gate. Follow is hidden when false and the viewer does not follow. */
  canComment: boolean;
}

/**
 * Follow the Task with your Soko Bot: it posts the Task's updates in your
 * chat with it. Separate from taking part: following never adds you to the
 * participants.
 */
export function TaskFollowControl({
  taskId,
  viewerId,
  viewerHasSokoBot,
  followers,
  canComment,
}: TaskFollowControlProps) {
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

  if (arm === null) return null;

  return (
    <>
      {followMarker === "1" ? (
        // Keyed: a fresh render that now shows the bot runs it again.
        <OnMount key={arm} run={resumeAfterSetup} />
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
          {t("follow")}
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
            {t("follow")}
          </Link>
        </Button>
      )}
    </>
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
