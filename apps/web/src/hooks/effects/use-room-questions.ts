"use client";

import type { DataRoomViewerQuestion } from "@sokosumi/core-client";
import { useEffect, useState } from "react";

/**
 * The viewer's own questions and the room's shared answers at `url`, with
 * whether they are still loading or failed to, and a way to load them again.
 */
export function useRoomQuestions(url: string) {
  const [questions, setQuestions] = useState<DataRoomViewerQuestion[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    fetch(url, attempt > 0 ? { cache: "no-store" } : undefined)
      .then((response) => {
        if (!response.ok) throw new Error(`Questions ${response.status}`);
        return response.json();
      })
      .then((loaded: DataRoomViewerQuestion[]) => {
        if (!current) return;
        setQuestions(loaded);
        setStatus("ready");
      })
      .catch(() => {
        if (current) setStatus("failed");
      });
    return () => {
      current = false;
    };
  }, [url, attempt]);
  return {
    questions,
    setQuestions,
    status,
    retry: () => {
      setStatus("loading");
      setAttempt((count) => count + 1);
    },
  };
}
