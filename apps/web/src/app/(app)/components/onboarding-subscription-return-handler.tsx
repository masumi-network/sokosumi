"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { completeOnboarding } from "@/lib/actions/onboarding";
import { fireGTMEvent } from "@/lib/gtm-events";
import { DEFAULT_AUTHENTICATED_LANDING_PATH } from "@/lib/utils/landing-path";

export function OnboardingSubscriptionReturnHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tErrors = useTranslations("Onboarding.Actions.Errors");
  const hasHandledRef = useRef(false);
  const onboardingSubscription = searchParams.get("onboarding_subscription");
  const status = searchParams.get("status");

  useEffect(() => {
    if (hasHandledRef.current) {
      return;
    }

    if (onboardingSubscription !== "1") {
      return;
    }

    if (status === "cancel") {
      hasHandledRef.current = true;
      router.replace(DEFAULT_AUTHENTICATED_LANDING_PATH);
      return;
    }

    if (status !== "success") {
      return;
    }

    hasHandledRef.current = true;

    void (async () => {
      try {
        const result = await completeOnboarding();
        if (!result.ok) {
          hasHandledRef.current = false;
          toast.error(result.error.message ?? tErrors("failedToComplete"));
          return;
        }

        fireGTMEvent.onboardingComplete();
        router.replace(
          result.value.redirectUrl ?? DEFAULT_AUTHENTICATED_LANDING_PATH,
        );
      } catch {
        hasHandledRef.current = false;
        toast.error(tErrors("unexpectedError"));
      }
    })();
  }, [onboardingSubscription, router, status, tErrors]);

  return null;
}
