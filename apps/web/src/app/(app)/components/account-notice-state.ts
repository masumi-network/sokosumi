export type AccountNoticeTone = "warning" | "destructive";

export type AccountNotice =
  | { type: "emailVerification"; email: string; tone: "warning" }
  | { type: "lowCredits"; path: string; tone: "warning" }
  | { type: "outOfCredits"; path: string; tone: "destructive" };

interface ResolveAccountNoticeParams {
  email: string | null | undefined;
  emailVerified: boolean;
  credits: number | null;
  currentPlan: string | null;
  threshold: number;
}

export function resolveLowCreditsBillingPath(
  currentPlan: string | null,
): string {
  if (currentPlan === null || currentPlan === "free") {
    return "/billing?tab=subscription";
  }

  return "/billing?tab=credits";
}

export function resolveAccountNotice({
  email,
  emailVerified,
  credits,
  currentPlan,
  threshold,
}: ResolveAccountNoticeParams): AccountNotice | null {
  if (!emailVerified && email) {
    return {
      email,
      tone: "warning",
      type: "emailVerification",
    };
  }

  if (typeof credits !== "number") {
    return null;
  }

  if (credits <= 0) {
    return {
      path: resolveLowCreditsBillingPath(currentPlan),
      tone: "destructive",
      type: "outOfCredits",
    };
  }

  if (credits >= threshold) {
    return null;
  }

  return {
    path: resolveLowCreditsBillingPath(currentPlan),
    tone: "warning",
    type: "lowCredits",
  };
}
