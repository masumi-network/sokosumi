import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  getCoworkerImageUrl,
  mapDbCoworkerToChatCoworker,
} from "@/app/chat/utils/coworker-utils";
import { toPaidSubscriptionPlanViews } from "@/components/billing/subscription-catalog-plans";
import type { PaidSubscriptionPlanView } from "@/components/billing/subscription-plan-utils";
import { getEnvPublicConfig } from "@/config/env.public";
import { canUseNextImageSrc } from "@/config/next-image";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import { coworkerService } from "@/lib/services/coworker.service";
import { DEFAULT_AUTHENTICATED_LANDING_PATH } from "@/lib/utils/landing-path";

import { OnboardingFlow } from "./components/onboarding-flow";
import { OnboardingStepSkeleton } from "./components/onboarding-loading-view";
import type { OnboardingCoworker } from "./components/steps/welcome-step";

/** Faces shown on the welcome screen; more than three crowds the row. */
const WELCOME_COWORKER_LIMIT = 3;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Onboarding.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface OnboardingPageProps {
  searchParams: Promise<{ preview?: string }>;
}

/**
 * `searchParams` is read inside the Suspense boundary, not in the route
 * component: touching URL data above it makes the whole navigation blocking
 * (Next.js `instant-shell-url-data`).
 */
export default function OnboardingPage({ searchParams }: OnboardingPageProps) {
  return (
    <Suspense fallback={<OnboardingStepSkeleton />}>
      <OnboardingFlowLoader searchParams={searchParams} />
    </Suspense>
  );
}

async function OnboardingFlowLoader({ searchParams }: OnboardingPageProps) {
  const [session, { preview }] = await Promise.all([
    getSessionOrRedirect(),
    searchParams,
  ]);

  // Preview is a local/staging affordance for walking every branch without
  // signing up again. It must never bypass the completion gate in production.
  const isPreview =
    preview === "1" &&
    getEnvPublicConfig().NEXT_PUBLIC_VERCEL_ENV !== "production";

  const [onboardingResult, catalogResult, coworkersResult] =
    await Promise.allSettled([
      coreClient.getMyOnboarding(),
      coreClient.getSubscriptionCatalog(),
      coworkerService.listCoworkers("chat"),
    ]);

  const isCompleted =
    onboardingResult.status === "fulfilled"
      ? onboardingResult.value.data.completed
      : // A failed read must not strand a finished user in onboarding forever,
        // but it also must not let an unfinished one skip it. The session flag
        // is the safer of the two signals available here.
        Boolean(session.user.onboardingCompleted);

  if (isCompleted && !isPreview) {
    redirect(DEFAULT_AUTHENTICATED_LANDING_PATH);
  }

  let paidPlans: PaidSubscriptionPlanView[] = [];
  if (catalogResult.status === "fulfilled") {
    // A brand-new account is always on the free tier, so nothing is "current".
    paidPlans = toPaidSubscriptionPlanViews(catalogResult.value.data, "free");
  } else {
    console.error(
      "Failed to load subscription catalog for onboarding",
      catalogResult.reason,
    );
  }

  const coworkers: OnboardingCoworker[] =
    coworkersResult.status === "fulfilled"
      ? coworkersResult.value
          .map(mapDbCoworkerToChatCoworker)
          .map((coworker) => {
            // Keyed by SLUG: the static fallback map is slug-keyed, so passing
            // the id silently yields null and drops the coworker entirely.
            // `avatar` is the IPFS/HTTP-resolved URL; the raw `image` can be an
            // `ipfs://` URI that no browser will load.
            const avatarUrl = getCoworkerImageUrl(
              coworker.slug ?? "",
              coworker.avatar,
            );

            return {
              // Vendors host avatars wherever they like, and next/image throws
              // on an unconfigured hostname — which would take down the first
              // page a new account ever sees. Fall back to initials.
              avatarUrl:
                avatarUrl && canUseNextImageSrc(avatarUrl) ? avatarUrl : null,
              name: coworker.name,
            };
          })
          .slice(0, WELCOME_COWORKER_LIMIT)
      : [];

  return (
    <OnboardingFlow
      coworkers={coworkers}
      isPreview={isPreview}
      paidPlans={paidPlans}
      userName={session.user.name?.split(" ")[0] ?? null}
    />
  );
}
