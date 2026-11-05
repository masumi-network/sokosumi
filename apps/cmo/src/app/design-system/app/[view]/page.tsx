import { notFound } from "next/navigation";

import { FixtureFrame, previewOnly } from "../../fixture-frame";
import { FixtureApp } from "../fixture-app";
import { isView } from "../fixtures";

interface AppViewPageProps {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ theme?: string | string[] }>;
}

/**
 * The signed-in app over fixture data and inert actions, so every page can be
 * looked at (and screenshotted) without Core. Local and preview deploys only.
 */
export default async function AppViewPage({
  params,
  searchParams,
}: AppViewPageProps) {
  previewOnly();
  const { view } = await params;
  if (!isView(view)) notFound();
  return (
    <FixtureFrame searchParams={searchParams}>
      <FixtureApp view={view} />
    </FixtureFrame>
  );
}
