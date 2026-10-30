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
  const connected =
    isProvider(provider) && !failed
      ? await finalizeMeasurement(provider).catch(() => false)
      : false;
  const back =
    params.get("from") === "app"
      ? new URL("/results", request.nextUrl)
      : new URL("/", request.nextUrl);
  if (params.get("from") !== "app") back.searchParams.set("step", "results");
  if (!connected) back.searchParams.set("measure", "failed");
  return NextResponse.redirect(back);
}
