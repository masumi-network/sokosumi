import { formatCreditsForDisplay } from "@/lib/utils/credits";

export const ACCOUNT_SUMMARY_POPOVER_CONTENT_CLASS =
  "bg-popover text-popover-foreground max-h-(--radix-popover-content-available-height) w-64 overflow-y-auto overscroll-contain rounded-xl border p-3 shadow-md";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type CreditRenewalKind =
  | { kind: "expired" }
  | { kind: "today" }
  | { kind: "inDays"; days: number };

export function resolveCreditRenewalKind(
  subscriptionPeriodEndMs: number | null,
  currentTimestampMs: number,
): CreditRenewalKind | null {
  if (subscriptionPeriodEndMs === null || currentTimestampMs <= 0) {
    return null;
  }

  const remainingMs = subscriptionPeriodEndMs - currentTimestampMs;
  if (remainingMs < 0) {
    return { kind: "expired" };
  }
  if (remainingMs < MILLISECONDS_PER_DAY) {
    return { kind: "today" };
  }

  return {
    kind: "inDays",
    days: Math.ceil(remainingMs / MILLISECONDS_PER_DAY),
  };
}

export function resolveAccountCreditsLabel(
  totalCredits: number | null,
  formatBalanceLabel: (credits: number) => string,
): string | null {
  if (totalCredits === null) {
    return null;
  }

  return formatBalanceLabel(formatCreditsForDisplay(totalCredits));
}

export function resolveAccountSummaryLabel({
  planName,
  creditsLabel,
  planAndCredits,
  detailsUnavailable,
}: {
  planName: string | null;
  creditsLabel: string | null;
  planAndCredits: (plan: string, credits: string) => string;
  detailsUnavailable: string;
}): string {
  if (planName !== null && creditsLabel !== null) {
    return planAndCredits(planName, creditsLabel);
  }

  return creditsLabel ?? planName ?? detailsUnavailable;
}

export function isLowCreditsBalance(
  totalCredits: number | null,
  lowCreditsThreshold: number,
): boolean {
  if (totalCredits === null) {
    return false;
  }

  const displayTotal = formatCreditsForDisplay(totalCredits);
  return displayTotal > 0 && displayTotal < lowCreditsThreshold;
}
