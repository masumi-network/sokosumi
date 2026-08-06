import { formatCreditsForDisplay } from "@/lib/utils/credits";

export const ACCOUNT_SUMMARY_POPOVER_CONTENT_CLASS =
  "bg-popover text-popover-foreground max-h-(--radix-popover-content-available-height) w-64 overflow-y-auto overscroll-contain rounded-xl border p-3 shadow-md";

export function resolveAccountDisplayName(name: string, email: string): string {
  return name.trim() || email;
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
