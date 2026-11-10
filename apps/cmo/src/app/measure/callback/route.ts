import type { CmoMeasurement } from "@sokosumi/core-client";
import { type NextRequest, NextResponse } from "next/server";

import { finalizeMeasurement } from "../../cmo-actions";

const PROVIDERS: CmoMeasurement["provider"][] = [
  "google_analytics",
  "google_search_console",
  "shopify",
];

function isProvider(value: string | null): value is CmoMeasurement["provider"] {
  return PROVIDERS.includes(value as CmoMeasurement["provider"]);
}

/** Composio sends the founder back here; finish the connection, then return to Results. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const provider = params.get("provider");
  const failed = /fail|error|cancel/i.test(params.get("status") ?? "");
  const sessionUri = params.get("session_uri") ?? params.get("sessionUri");
  // The Project the connect started from; without it nothing is finished.
  const project = params.get("project");
  const connected =
    project && isProvider(provider) && !failed
      ? await finalizeMeasurement(project, provider, sessionUri).catch(
          () => false,
        )
      : false;
  const back =
    params.get("from") === "app"
      ? new URL("/results", request.nextUrl)
      : new URL("/", request.nextUrl);
  if (params.get("from") !== "app") {
    back.searchParams.set("step", "results");
    back.searchParams.set("from", "onboarding");
  }
  if (!connected) back.searchParams.set("measure", "failed");
  if (project) back.searchParams.set("project", project);
  return NextResponse.redirect(back);
}
