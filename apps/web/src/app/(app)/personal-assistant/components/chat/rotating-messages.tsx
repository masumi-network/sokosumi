"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Cycles short phrases with a fade so long waits read as alive, not stuck. */
export function RotatingMessages({
  messages,
  intervalMs = 5_000,
  className,
}: {
  messages: readonly string[];
  intervalMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (messages.length === 0) return;
    const fadeOut = window.setTimeout(
      () => setVisible(false),
      intervalMs - 400,
    );
    const advance = window.setTimeout(() => {
      setIndex((i) => (i + 1) % messages.length);
      setVisible(true);
    }, intervalMs);
    return () => {
      window.clearTimeout(fadeOut);
      window.clearTimeout(advance);
    };
  }, [index, messages.length, intervalMs]);

  if (messages.length === 0) return null;

  return (
    <span
      className={cn(
        "transition-opacity duration-400 ease-out",
        visible ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {messages[index]}
    </span>
  );
}
