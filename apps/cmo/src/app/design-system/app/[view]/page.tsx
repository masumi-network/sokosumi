import "../../design-system.css";

import { notFound } from "next/navigation";

import { FixtureApp } from "../fixture-app";
import { isView } from "../fixtures";

/**
 * The signed-in app over fixture data and inert actions, so every page can be
 * looked at (and screenshotted) without Core. `?theme=dark` or `?theme=light`
 * pins the theme on a wrapper. Local and preview deploys only.
 */
export default async function AppViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ theme?: string | string[] }>;
}) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { view } = await params;
  if (!isView(view)) notFound();
  const { theme } = await searchParams;
  const pinned = theme === "dark" || theme === "light" ? theme : null;
  return (
    <div className={pinned ? `ds-screen theme-scope ${pinned}` : undefined}>
      <FixtureApp view={view} />
    </div>
  );
}
