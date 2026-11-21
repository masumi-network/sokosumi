"use client";

import { useEffect, useEffectEvent } from "react";

/**
 * The Task this tab started setup for. A `?follow=1` link alone follows
 * nothing: only a setup started here by a click does.
 */
const FOLLOW_AFTER_SETUP_SESSION_KEY = "sokosumi.tasks.followAfterSetup";

export function rememberFollowAfterSetup(taskId: string): void {
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

export type TaskFollowArm = "active" | "add" | "setup" | null;

interface UseResumeTaskFollowAfterSetupOptions {
  taskId: string;
  arm: TaskFollowArm;
  active: boolean;
  onClearMarker: () => void;
  onAutoFollow: () => void;
}

/**
 * Consumes the one-shot post-setup follow hand-off when returning to a Task
 * with `?follow=1`, waiting until the viewer's Soko Bot is offered (`add` or
 * `active`) before clearing the URL marker and session hand-off.
 */
export function useResumeTaskFollowAfterSetup({
  taskId,
  arm,
  active,
  onClearMarker,
  onAutoFollow,
}: UseResumeTaskFollowAfterSetupOptions): void {
  const resume = useEffectEvent(() => {
    // No follow offered yet: a copy of this page rendered before the bot
    // existed, or a read failed for a moment. Keep the hand-off for the
    // render that offers it.
    if (arm !== "add" && arm !== "active") return;
    // Read once: the marker and the stored Task are gone after this, so no
    // later visit or reload follows without a click.
    onClearMarker();
    const startedHere = takeFollowAfterSetup() === taskId;
    if (startedHere && arm === "add") onAutoFollow();
  });

  useEffect(() => {
    void arm;
    if (!active) return;
    resume();
  }, [active, arm]);
}
