"use client";

import type { PaidSubscriptionPlanName } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  OrganizationSeatSettingsFields,
  resolveMinimumOrganizationSeats,
  resolveTargetOrganizationSeats,
} from "@/components/billing/organization-seat-settings-fields";
import { toastSubscriptionActionError } from "@/components/billing/subscription-action-error-toast";
import {
  hasSelectablePaidPlan,
  type PaidSubscriptionPlanView,
  resolveInitialSelectedPlan,
} from "@/components/billing/subscription-plan-utils";
import { OnboardingPlanRadioGrid } from "@/components/onboarding/onboarding-plan-radio-grid";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { completeOnboarding } from "@/lib/actions/onboarding";
import {
  upgradeOrganizationSubscription,
  upgradePersonalSubscription,
} from "@/lib/actions/subscription";
import { markSubscriptionOnboardingGateSeenSafely } from "@/lib/onboarding/mark-subscription-onboarding-gate-seen.client";

const SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY =
  "sokosumi.onboarding.subscription.lastLoginId";

export type OnboardingSubscriptionCheckoutMode =
  | "organization"
  | "personal"
  | "restricted";

function readLastSubscriptionOnboardingLoginId(): null | string {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const loginId = window.localStorage.getItem(
      SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
    );
    return loginId ? loginId : null;
  } catch {
    return null;
  }
}

function writeLastSubscriptionOnboardingLoginId(loginId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
      loginId,
    );
  } catch {
    // Ignore localStorage write errors (quota, privacy mode, etc.).
  }
}

function shouldOpenSubscriptionOnboarding(loginId?: null | string): boolean {
  if (!loginId) {
    return true;
  }

  return readLastSubscriptionOnboardingLoginId() !== loginId;
}

interface SubscriptionOnboardingDialogProps {
  loginId?: null | string;
  organizationSubscription?: {
    assignedSeatCount: number;
    currentSeats: number;
    memberCount: number;
    organizationId: string;
  };
  paidPlans: PaidSubscriptionPlanView[];
  subscriptionCheckoutMode: OnboardingSubscriptionCheckoutMode;
}

/**
 * Upgrade nudge for signed-in accounts still on the free plan.
 *
 * Distinct from signup onboarding, which is a full page at `/onboarding`:
 * this fires later, once per login, for users who already finished that flow.
 */
export function SubscriptionOnboardingDialog({
  loginId,
  organizationSubscription,
  paidPlans,
  subscriptionCheckoutMode,
}: SubscriptionOnboardingDialogProps) {
  const tMetadata = useTranslations("Onboarding.Metadata");
  const tDialog = useTranslations("Onboarding.Dialog");
  const tErrors = useTranslations("Onboarding.Actions.Errors");
  const tOrganizationSubscriptions = useTranslations(
    "App.Organizations.OrganizationDetail.Subscription",
  );
  const tSubscriptions = useTranslations("App.Subscriptions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PaidSubscriptionPlanName>(
    () => resolveInitialSelectedPlan(paidPlans),
  );
  const [targetSeats, setTargetSeats] = useState(() =>
    organizationSubscription
      ? resolveTargetOrganizationSeats(
          organizationSubscription.currentSeats,
          organizationSubscription.assignedSeatCount,
        )
      : 1,
  );
  const isRestrictedOrganizationGate =
    subscriptionCheckoutMode === "restricted";

  useEffect(() => {
    if (isRestrictedOrganizationGate) {
      setOpen(false);
      // Do not mark the session cookie: the user never saw a checkout-capable
      // gate. Marking would make AppLayout skip the loader for this session
      // everywhere (e.g. personal workspace) until the session changes.
      return;
    }

    if (!shouldOpenSubscriptionOnboarding(loginId)) {
      setOpen(false);
      if (loginId) {
        markSubscriptionOnboardingGateSeenSafely(loginId);
      }
      return;
    }

    // Skip cookie only after localStorage suppresses the gate — setting it on
    // first open refreshes RSC and unmounts this dialog.

    if (loginId) {
      writeLastSubscriptionOnboardingLoginId(loginId);
    }

    setOpen(true);
  }, [isRestrictedOrganizationGate, loginId]);

  if (!open) return null;

  function handleSkip() {
    track("Onboarding skipped");
    if (loginId) {
      writeLastSubscriptionOnboardingLoginId(loginId);
      markSubscriptionOnboardingGateSeenSafely(loginId);
    }
    setOpen(false);
  }

  const handleComplete = async (eventName: string) => {
    track(eventName);
    setIsLoading(true);
    try {
      const result = await completeOnboarding();
      if (result.ok) {
        const redirectUrl = result.value.redirectUrl ?? "/agents";
        setOpen(false);
        router.push(redirectUrl);
      } else {
        toast.error(result.error.message ?? tErrors("failedToComplete"));
      }
    } catch {
      toast.error(tErrors("unexpectedError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartSubscription = async () => {
    const organizationId = organizationSubscription?.organizationId;
    const minimumSeats = organizationSubscription
      ? resolveMinimumOrganizationSeats(
          organizationSubscription.assignedSeatCount,
        )
      : 1;

    if (
      organizationSubscription &&
      (!Number.isInteger(targetSeats) || targetSeats < minimumSeats)
    ) {
      toast.error(tOrganizationSubscriptions("Errors.badInput"));
      return;
    }

    track("Onboarding plan checkout started", {
      customerType: organizationId ? "organization" : "user",
      plan: selectedPlan,
      ...(organizationId ? { seats: targetSeats } : {}),
    });
    setIsLoading(true);

    try {
      const result = organizationId
        ? await upgradeOrganizationSubscription({
            organizationId,
            plan: selectedPlan,
            returnPath: "/tasks?onboarding_subscription=1",
            seats: targetSeats,
          })
        : await upgradePersonalSubscription({
            plan: selectedPlan,
            returnPath: "/tasks?onboarding_subscription=1",
          });

      if (!result.ok) {
        toastSubscriptionActionError(
          result.error,
          organizationId
            ? {
                badInputMessage: tOrganizationSubscriptions("Errors.badInput"),
                generalMessage: tOrganizationSubscriptions("Errors.general"),
                onUnauthenticated: () => router.push("/login"),
                unauthenticatedActionLabel: tOrganizationSubscriptions(
                  "Errors.unauthenticatedAction",
                ),
                unauthenticatedMessage: tOrganizationSubscriptions(
                  "Errors.unauthenticated",
                ),
                unauthorizedMessage: tOrganizationSubscriptions(
                  "Errors.unauthorized",
                ),
              }
            : {
                badInputMessage: tSubscriptions("Errors.badInput"),
                generalMessage: tSubscriptions("Errors.general"),
                onUnauthenticated: () => router.push("/login"),
                unauthenticatedActionLabel: tSubscriptions(
                  "Errors.unauthenticatedAction",
                ),
                unauthenticatedMessage: tSubscriptions(
                  "Errors.unauthenticated",
                ),
              },
        );
        return;
      }

      if (result.value.mode === "redirect") {
        window.location.href = result.value.url;
        return;
      }

      toast.success(tSubscriptions("statusSuccess"));
      await handleComplete("Onboarding subscription completed");
    } catch {
      toast.error(tErrors("unexpectedError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-6xl! h-full md:h-auto overflow-hidden border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[90vw] [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="hidden">{tMetadata("title")}</DialogTitle>
        <DialogDescription className="hidden">
          {tMetadata("description")}
        </DialogDescription>

        <div className="bg-background flex max-h-svh flex-col overflow-hidden rounded-xl shadow-lg md:max-h-[85vh]">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:overflow-hidden">
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center md:overflow-y-auto md:p-10">
              <div className="w-full max-w-5xl space-y-6 text-left">
                <div className="space-y-3 text-center">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {tDialog("intro.plans.title")}
                  </h2>
                  <p className="text-muted-foreground mx-auto max-w-2xl text-[0.9375rem] leading-relaxed">
                    {tDialog("intro.plans.description")}
                  </p>
                </div>
                {organizationSubscription ? (
                  <div className="rounded-xl border p-4 md:p-6">
                    <OrganizationSeatSettingsFields
                      assignedSeatCount={
                        organizationSubscription.assignedSeatCount
                      }
                      inputId="onboarding-organization-seats"
                      memberCount={organizationSubscription.memberCount}
                      onTargetSeatsChange={setTargetSeats}
                      targetSeats={targetSeats}
                    />
                  </div>
                ) : null}
                <OnboardingPlanRadioGrid
                  plans={paidPlans}
                  value={selectedPlan}
                  onValueChange={setSelectedPlan}
                />
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t px-6 pt-4 pb-6 md:px-10 md:pt-5 md:pb-8">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={handleSkip}
                disabled={isLoading}
              >
                {tDialog("navigation.skip")}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleStartSubscription()}
                disabled={isLoading || !hasSelectablePaidPlan(paidPlans)}
              >
                {tDialog("navigation.subscribe")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
