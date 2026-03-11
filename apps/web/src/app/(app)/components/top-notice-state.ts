export type AppTopNotice =
  | { kind: "none" }
  | { email: string; kind: "emailVerification" }
  | { kind: "lowCredits"; path: string }
  | { kind: "outOfCredits"; path: string };

interface ResolveAppTopNoticeParams {
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

export function resolveAppTopNotice({
  email,
  emailVerified,
  credits,
  currentPlan,
  threshold,
}: ResolveAppTopNoticeParams): AppTopNotice {
  if (!emailVerified && email) {
    return {
      email,
      kind: "emailVerification",
    };
  }

  if (typeof credits !== "number") {
    return { kind: "none" };
  }

  if (credits <= 0) {
    return {
      kind: "outOfCredits",
      path: resolveLowCreditsBillingPath(currentPlan),
    };
  }

  if (credits >= threshold) {
    return { kind: "none" };
  }

  return {
    kind: "lowCredits",
    path: resolveLowCreditsBillingPath(currentPlan),
  };
}
