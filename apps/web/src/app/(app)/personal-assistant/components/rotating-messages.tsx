"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface RotatingMessagesProps {
  messages: readonly string[];
  /** Time each message stays before fading to the next. Defaults to 5s. */
  intervalMs?: number;
  /** Tailwind classes applied to the message text. */
  className?: string;
}

/**
 * Cycles through a list of short messages with a fade-in/fade-out so the
 * static loading screens (ProvisioningState, OnboardingProgress) feel like
 * something is happening even when the backend is the slow part. Used for
 * sneaking in fun facts / hints about Hermes during long waits.
 */
export default function RotatingMessages({
  messages,
  intervalMs = 5_000,
  className,
}: RotatingMessagesProps) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (messages.length === 0) return;
    const fadeOut = window.setTimeout(
      () => setVisible(false),
      intervalMs - 400,
    );
    const advance = window.setTimeout(() => {
      setIdx((i) => (i + 1) % messages.length);
      setVisible(true);
    }, intervalMs);
    return () => {
      window.clearTimeout(fadeOut);
      window.clearTimeout(advance);
    };
  }, [idx, messages.length, intervalMs]);

  if (messages.length === 0) return null;

  return (
    <div
      className={cn(
        "transition-opacity duration-400 ease-out",
        visible ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {messages[idx]}
    </div>
  );
}
