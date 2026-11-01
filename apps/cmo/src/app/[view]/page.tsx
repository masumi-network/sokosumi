import { notFound } from "next/navigation";

import { viewFromPath } from "../../lib/views";
import { Home, type HomeSearchParams } from "../home";

/** Strategy, Results, Brand Brain, Channels and Settings, each at its own address. */
export default async function ViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<HomeSearchParams>;
}) {
  const view = viewFromPath(`/${(await params).view}`);
  if (!view || view === "chat") notFound();
  return Home({ searchParams, view });
}
