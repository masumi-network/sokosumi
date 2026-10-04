"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const COOLDOWN_SECONDS = 30;

interface ResendButtonProps {
  /** When the current code went out, in epoch milliseconds. */
  sentAt: number;
  onResend: () => void;
  isSending: boolean;
  /** What is sent again, e.g. a reset link; a code when absent. */
  labels?: { resend: string; resendIn: (seconds: number) => string };
}

function secondsLeft(sentAt: number, now: number): number {
  const left = Math.ceil((sentAt + COOLDOWN_SECONDS * 1000 - now) / 1000);
  return Math.min(COOLDOWN_SECONDS, Math.max(0, left));
}

/**
 * Asks for the email again, a code or a reset link, but not within 30
 * seconds of the last one: the first email is usually still on its way, and
 * Core limits sends a minute. The countdown is in the label, not announced
 * each second.
 */
export function ResendButton({
  sentAt,
  onResend,
  isSending,
  labels,
}: ResendButtonProps) {
  const t = useTranslations("Components.EmailCodeForm");
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

  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground focus-visible:ring-ring-halo rounded-sm text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:no-underline"
      disabled={left > 0 || isSending}
      onClick={onResend}
    >
      {left > 0
        ? (labels?.resendIn(left) ?? t("resendIn", { seconds: left }))
        : (labels?.resend ?? t("resend"))}
    </button>
  );
}
