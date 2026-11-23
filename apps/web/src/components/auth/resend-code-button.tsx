"use client";

import { useTranslations } from "next-intl";
import { useResendCodeCooldown } from "@/hooks/effects/use-resend-code-cooldown";

interface ResendCodeButtonProps {
  /** When the current code went out, in epoch milliseconds. */
  sentAt: number;
  onResend: () => void;
  isSending: boolean;
}

/**
 * Asks for the code again, but not within 30 seconds of the last one: the
 * first email is usually still on its way, and Core allows three sends a
 * minute. The countdown is in the label, not announced each second.
 */
export function ResendCodeButton({
  sentAt,
  onResend,
  isSending,
}: ResendCodeButtonProps) {
  const t = useTranslations("Components.EmailCodeForm");
  const left = useResendCodeCooldown(sentAt);

  return (
    <button
      type="button"
      className="text-muted-foreground inline-flex min-h-6 items-center hover:text-foreground disabled:hover:text-muted-foreground focus-visible:ring-ring rounded-sm text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:no-underline"
      disabled={left > 0 || isSending}
      onClick={onResend}
    >
      {left > 0 ? t("resendIn", { seconds: left }) : t("resend")}
    </button>
  );
}
