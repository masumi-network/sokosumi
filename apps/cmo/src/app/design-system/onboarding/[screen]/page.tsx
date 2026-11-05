import "../../design-system.css";

import { notFound } from "next/navigation";

import { FixtureScreen } from "../fixture-screen";
import { isScreen } from "../fixtures";

/**
 * A real onboarding screen over fixture data and inert actions, so it can be
 * looked at (and screenshotted) without Core. `?theme=dark` or `?theme=light`
 * pins the theme on a wrapper. Local and preview deploys only.
 */
export default async function OnboardingScreenPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<{ theme?: string | string[] }>;
}) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { screen } = await params;
  if (!isScreen(screen)) notFound();
  const { theme } = await searchParams;
  const pinned = theme === "dark" || theme === "light" ? theme : null;
  return (
    <div className={pinned ? `ds-screen theme-scope ${pinned}` : undefined}>
      <FixtureScreen screen={screen} />
    </div>
  );
}
