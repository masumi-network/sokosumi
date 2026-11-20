import { notFound } from "next/navigation";

import { FixtureFrame, previewOnly } from "../../fixture-frame";
import { FixturePage } from "../fixture-page";
import { isFixturePage } from "../fixtures";

interface FixturePageRouteProps {
  params: Promise<{ page: string }>;
  searchParams: Promise<{ theme?: string | string[] }>;
}

/** A page around sign in, or the error page, without Core. */
export default async function FixturePageRoute({
  params,
  searchParams,
}: FixturePageRouteProps) {
  previewOnly();
  const { page } = await params;
  if (!isFixturePage(page)) notFound();
  return (
    <FixtureFrame searchParams={searchParams}>
      <FixturePage page={page} />
    </FixtureFrame>
  );
}
