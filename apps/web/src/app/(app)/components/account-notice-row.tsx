"use client";

import { AlertTriangle, ArrowUpRight, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { getAccountNoticePath } from "@/app/components/account-notice-action";
import { Button } from "@/components/ui/button";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { cn } from "@/lib/utils";

import VerifyEmailButton from "./verify-email-button";

const ACCOUNT_NOTICE_STYLES = {
  warning: {
    action:
      "border-semantic-warning-tertiary text-semantic-warning hover:bg-semantic-warning-quinary hover:text-semantic-warning bg-transparent",
    container:
      "border-semantic-warning-tertiary bg-semantic-warning-quinary text-semantic-warning",
    text: "text-semantic-warning",
  },
  destructive: {
    action:
      "border-semantic-destructive-tertiary text-semantic-destructive hover:bg-semantic-destructive-quinary hover:text-semantic-destructive bg-transparent",
    container:
      "border-semantic-destructive-tertiary bg-semantic-destructive-quinary text-semantic-destructive",
    text: "text-semantic-destructive",
  },
} as const;

interface AccountNoticeRowProps {
  className?: string;
  /** Use inside the notification panel, where the whole notice is one link. */
  variant?: "card" | "panel";
  onActionComplete?: () => void;
}

export function AccountNoticeRow({
  className,
  variant = "card",
  onActionComplete,
}: AccountNoticeRowProps) {
  const { notice } = useAccountNotice();
  const tEmail = useTranslations("App.EmailVerificationNotice");
  const tCenter = useTranslations("Components.NotificationCenter");
  const tCredits = useTranslations("App.LowCreditsNotice");

  if (!notice) {
    return null;
  }

  const styles = ACCOUNT_NOTICE_STYLES[notice.tone];
  const Icon = notice.tone === "destructive" ? CircleAlert : AlertTriangle;

  let title: string;
  let description: string;
  let actionLabel: string;

  if (notice.type === "emailVerification") {
    title = tEmail("title");
    description = tEmail("description");
    actionLabel = tEmail("button");
  } else {
    const routeKey = notice.path.includes("tab=subscription")
      ? "subscription"
      : "credits";
    const stateKey =
      notice.type === "outOfCredits" ? "outOfCredits" : "almostOut";

    title = tCredits(`${routeKey}.${stateKey}.title`);
    description = tCredits(`${routeKey}.${stateKey}.description`);
    actionLabel = tCredits(`${routeKey}.button`);
  }

  const content = (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className={cn("text-sm font-medium", styles.text)}>{title}</p>
        <p className={cn("text-sm", styles.text)}>{description}</p>
        {variant === "card" ? (
          notice.type === "emailVerification" ? (
            <VerifyEmailButton
              email={notice.email}
              label={actionLabel}
              variant="outline"
              size="sm"
              className={cn("self-start", styles.action)}
            />
          ) : (
            <Button
              asChild
              variant="outline"
              size="sm"
              className={cn("self-start", styles.action)}
            >
              <Link href={notice.path}>
                <span>{actionLabel}</span>
                <ArrowUpRight aria-hidden />
              </Link>
            </Button>
          )
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 self-start rounded-md border px-3 py-1.5 text-sm font-medium",
              styles.action,
            )}
          >
            {/* The panel cannot host the security check, so it leads to the
                notifications page where the resend button lives. */}
            {notice.type === "emailVerification"
              ? tCenter("view")
              : actionLabel}
            <ArrowUpRight aria-hidden />
          </span>
        )}
      </div>
    </div>
  );

  if (variant === "panel") {
    return (
      <Link
        href={getAccountNoticePath(notice)}
        className={cn(
          "mx-2 my-1 flex flex-col items-start gap-3 rounded-lg border p-4 text-left",
          styles.container,
          className,
        )}
        onClick={onActionComplete}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        styles.container,
        className,
      )}
    >
      {content}
    </div>
  );
}

export function useAccountNoticeCopy(): {
  description: string;
  title: string;
} | null {
  const { notice } = useAccountNotice();
  const tEmail = useTranslations("App.EmailVerificationNotice");
  const tCredits = useTranslations("App.LowCreditsNotice");

  if (!notice) {
    return null;
  }

  if (notice.type === "emailVerification") {
    return {
      description: tEmail("description"),
      title: tEmail("title"),
    };
  }

  const routeKey = notice.path.includes("tab=subscription")
    ? "subscription"
    : "credits";
  const stateKey =
    notice.type === "outOfCredits" ? "outOfCredits" : "almostOut";

  return {
    description: tCredits(`${routeKey}.${stateKey}.description`),
    title: tCredits(`${routeKey}.${stateKey}.title`),
  };
}
