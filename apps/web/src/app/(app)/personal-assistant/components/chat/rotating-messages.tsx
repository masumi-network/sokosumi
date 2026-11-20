"use client";

import { useState } from "react";

import { useTimeout } from "@/hooks/effects/use-timeout";
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
  const delay = messages.length > 0 ? intervalMs : null;
  const cycleKey = `${index}:${messages.length}`;

  useTimeout(
    () => setVisible(false),
    delay !== null ? delay - 400 : null,
    cycleKey,
  );
  useTimeout(
    () => {
      setIndex((i) => (i + 1) % messages.length);
      setVisible(true);
    },
    delay,
    cycleKey,
  );

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
