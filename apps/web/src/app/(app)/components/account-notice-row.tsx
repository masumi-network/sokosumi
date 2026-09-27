"use client";

import { Coins, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { getAccountNoticePath } from "@/app/components/account-notice-action";
import type { AccountNotice } from "@/app/components/account-notice-state";
import {
  type NotificationRequestEmphasis,
  NotificationRequestRow,
  notificationRequestActionClassName,
} from "@/components/notifications/notification-request-row";
import { Button } from "@/components/ui/button";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { cn } from "@/lib/utils";

import VerifyEmailButton from "./verify-email-button";

/** A filled row's action takes the row's colour; the others stay neutral. */
const FILLED_ACTION_STYLES = {
  warning:
    "border-semantic-warning-tertiary text-semantic-warning hover:bg-semantic-warning-quinary hover:text-semantic-warning bg-transparent",
  destructive:
    "border-semantic-destructive-tertiary text-semantic-destructive hover:bg-semantic-destructive-quinary hover:text-semantic-destructive bg-transparent",
} as const;

/**
 * Filled when the reader is blocked until they act: an unverified email
 * locks paid features, and no credits stops work. Low credits only warns, so
 * it is marked. The colour stays the notice's tone, the same one the bell's
 * dot takes.
 */
export function getAccountNoticeEmphasis(
  notice: AccountNotice,
): NotificationRequestEmphasis {
  if (notice.type === "lowCredits") {
    return "marked";
  }

  return notice.tone === "destructive"
    ? "filled-destructive"
    : "filled-warning";
}

interface AccountNoticeRowProps {
  /** The panel cannot host the security check the resend button runs. */
  variant: "panel" | "page";
  onActionComplete?: () => void;
}

export function AccountNoticeRow({
  variant,
  onActionComplete,
}: AccountNoticeRowProps) {
  const { notice } = useAccountNotice();
  const tEmail = useTranslations("App.EmailVerificationNotice");
  const tCenter = useTranslations("Components.NotificationCenter");
  const tCredits = useTranslations("App.LowCreditsNotice");

  if (!notice) {
    return null;
  }

  const emphasis = getAccountNoticeEmphasis(notice);
  const actionClassName = cn(
    notificationRequestActionClassName,
    emphasis === "marked" ? undefined : FILLED_ACTION_STYLES[notice.tone],
  );

  let title: string;
  let description: string;
  let actionLabel: string;

  if (notice.type === "emailVerification") {
    title = tEmail("title");
    description = tEmail("description");
    // The panel leads to the notifications page, where the resend button
    // and its security check live.
    actionLabel = variant === "page" ? tEmail("button") : tCenter("view");
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

  const action =
    notice.type === "emailVerification" && variant === "page" ? (
      <VerifyEmailButton
        email={notice.email}
        label={actionLabel}
        variant="outline"
        size="sm"
        className={actionClassName}
      />
    ) : (
      <Button asChild variant="outline" size="sm" className={actionClassName}>
        <Link href={getAccountNoticePath(notice)} onClick={onActionComplete}>
          {actionLabel}
        </Link>
      </Button>
    );

  return (
    <NotificationRequestRow
      emphasis={emphasis}
      icon={notice.type === "emailVerification" ? Mail : Coins}
      title={title}
      description={description}
      action={action}
    />
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
