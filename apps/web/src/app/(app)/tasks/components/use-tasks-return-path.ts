"use client";

import { useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

import { getStoredTasksReturnPath } from "./task-navigation";

/**
 * Client-only tasks list return path from sessionStorage (set by TaskDetailLink).
 * Defaults to `/tasks` until mount reads storage (avoids SSR/hydration mismatch).
 */
export function useTasksReturnPath() {
  const [returnPath, setReturnPath] = useState("/tasks");

  useMountEffect(() => {
    setReturnPath(getStoredTasksReturnPath());
  });

  return returnPath;
}
