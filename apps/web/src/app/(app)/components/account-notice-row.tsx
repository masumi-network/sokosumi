"use client";

import { AlertTriangle, ArrowUpRight, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

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
}

export function AccountNoticeRow({ className }: AccountNoticeRowProps) {
  const { notice } = useAccountNotice();
  const tEmail = useTranslations("App.EmailVerificationNotice");
  const tCredits = useTranslations("App.LowCreditsNotice");

  if (!notice) {
    return null;
  }

  const styles = ACCOUNT_NOTICE_STYLES[notice.tone];
  const Icon = notice.tone === "destructive" ? CircleAlert : AlertTriangle;

  if (notice.type === "emailVerification") {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-col gap-3 rounded-lg border p-4",
          styles.container,
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className={cn("text-sm font-medium", styles.text)}>
              {tEmail("title")}
            </p>
            <p className={cn("text-sm", styles.text)}>
              {tEmail("description")}
            </p>
            <VerifyEmailButton
              email={notice.email}
              label={tEmail("button")}
              variant="outline"
              size="sm"
              className={cn("self-start", styles.action)}
            />
          </div>
        </div>
      </div>
    );
  }

  const routeKey = notice.path.includes("tab=subscription")
    ? "subscription"
    : "credits";
  const stateKey =
    notice.type === "outOfCredits" ? "outOfCredits" : "almostOut";

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        styles.container,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className={cn("text-sm font-medium", styles.text)}>
            {tCredits(`${routeKey}.${stateKey}.title`)}
          </p>
          <p className={cn("text-sm", styles.text)}>
            {tCredits(`${routeKey}.${stateKey}.description`)}
          </p>
          <Button
            asChild
            variant="outline"
            size="sm"
            className={cn("self-start", styles.action)}
          >
            <Link href={notice.path}>
              <span>{tCredits(`${routeKey}.button`)}</span>
              <ArrowUpRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
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
