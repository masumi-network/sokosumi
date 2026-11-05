import { notFound } from "next/navigation";

import { FixtureFrame, previewOnly } from "../../fixture-frame";
import { FixtureScreen } from "../fixture-screen";
import { isScreen } from "../fixtures";

interface OnboardingScreenPageProps {
  params: Promise<{ screen: string }>;
  searchParams: Promise<{ theme?: string | string[] }>;
}

/**
 * A real onboarding screen over fixture data and inert actions, so it can be
 * looked at (and screenshotted) without Core. Local and preview deploys only.
 */
export default async function OnboardingScreenPage({
  params,
  searchParams,
}: OnboardingScreenPageProps) {
  previewOnly();
  const { screen } = await params;
  if (!isScreen(screen)) notFound();
  return (
    <FixtureFrame searchParams={searchParams}>
      <FixtureScreen screen={screen} />
    </FixtureFrame>
  );
}
