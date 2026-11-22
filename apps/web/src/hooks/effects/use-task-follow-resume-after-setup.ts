"use client";

import { useEffect } from "react";

/**
 * The Task this tab started setup for. A `?follow=1` link alone follows
 * nothing: only a setup started here by a click does.
 */
export const FOLLOW_AFTER_SETUP_SESSION_KEY = "sokosumi.tasks.followAfterSetup";

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

export type TaskFollowArm = "active" | "add" | "setup" | null;

export interface UseTaskFollowResumeAfterSetupOptions {
  arm: TaskFollowArm;
  taskId: string;
  setFollowMarker: (value: null) => unknown;
  onFollow: () => void;
}

/**
 * Runs once when `TaskFollowControl`'s keyed resume child mounts while the
 * setup marker is present. Strict mode runs it twice in development: the
 * stored Task is read once, so the second run follows nothing.
 */
export function useTaskFollowResumeAfterSetup({
  arm,
  taskId,
  setFollowMarker,
  onFollow,
}: UseTaskFollowResumeAfterSetupOptions): void {
  useEffect(() => {
    // No follow offered yet: a copy of this page rendered before the bot
    // existed, or a read failed for a moment. Keep the hand-off for the
    // render that offers it.
    if (arm !== "add" && arm !== "active") return;
    // Read once: the marker and the stored Task are gone after this, so no
    // later visit or reload follows without a click.
    void setFollowMarker(null);
    const startedHere = takeFollowAfterSetup() === taskId;
    if (startedHere && arm === "add") onFollow();
  }, []);
}
