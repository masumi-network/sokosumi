"use client";

import { useQueryState } from "nuqs";
import { useEffect, useEffectEvent } from "react";
import { FOLLOW_AFTER_SETUP_PARAM } from "@/lib/workspace-gate";

/**
 * The Task this tab started setup for. A `?follow=1` link alone follows
 * nothing: only a setup started here by a click does.
 */
const FOLLOW_AFTER_SETUP_SESSION_KEY = "sokosumi.tasks.followAfterSetup";

export type TaskFollowArm = "active" | "add" | "setup" | null;

export function rememberFollowAfterSetup(taskId: string) {
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

/**
 * Consumes the one-time `?follow=1` return marker and `sessionStorage`
 * hand-off once the Task follow control offers follow (`arm` is `"add"` or
 * `"active"`). StrictMode runs the effect twice in development: the stored Task
 * is read once, so the second run follows nothing.
 */
export function useTaskFollowAfterSetup(
  taskId: string,
  arm: TaskFollowArm,
  onFollow: () => void,
): void {
  const [followMarker, setFollowMarker] = useQueryState(
    FOLLOW_AFTER_SETUP_PARAM,
  );
  const handleFollow = useEffectEvent(onFollow);

  useEffect(() => {
    if (followMarker !== "1") return;
    // No follow offered yet: a copy of this page rendered before the bot
    // existed, or a read failed for a moment. Keep the hand-off for the
    // render that offers it.
    if (arm !== "add" && arm !== "active") return;
    // Read once: the marker and the stored Task are gone after this, so no
    // later visit or reload follows without a click.
    void setFollowMarker(null);
    const startedHere = takeFollowAfterSetup() === taskId;
    if (startedHere && arm === "add") handleFollow();
  }, [arm, followMarker, setFollowMarker, taskId]);
}
