"use client";

import { useEffect, useState } from "react";

const COOLDOWN_SECONDS = 30;

function secondsLeft(sentAt: number, now: number): number {
  const left = Math.ceil((sentAt + COOLDOWN_SECONDS * 1000 - now) / 1000);
  return Math.min(COOLDOWN_SECONDS, Math.max(0, left));
}

/**
 * Counts down the remaining cooldown seconds for `ResendCodeButton` from
 * `sentAt`, clearing its 1-second interval once the cooldown reaches 0.
 */
export function useResendCodeCooldown(sentAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  const left = secondsLeft(sentAt, now);

  // Synchronizes with the clock until the wait is over.
  useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (secondsLeft(sentAt, current) === 0) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [sentAt]);

  return left;
}
