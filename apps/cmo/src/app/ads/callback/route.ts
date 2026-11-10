import { type NextRequest, NextResponse } from "next/server";

import { finalizeAds } from "../../cmo-actions";

/** Where the founder goes back to: the Accounts step, or Channels in the app. */
function adsReturn(request: NextRequest, from: string | null): URL {
  if (from === "app") return new URL("/channels", request.nextUrl);
  const back = new URL("/", request.nextUrl);
  back.searchParams.set("step", "connect");
  // Back on the Accounts step, which stays open until Continue.
  back.searchParams.set("from", "onboarding");
  return back;
}

/**
 * Google or Meta sends the founder back here: finish the connection, then
 * return, or let them pick the ad account when the login reaches several.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  // The Project the connect started from; without it nothing is finished.
  const project = params.get("project");
  const connectionId =
    params.get("connectedAccountId") ??
    params.get("connected_account_id") ??
    params.get("connectionId");
  const sessionUri = params.get("session_uri") ?? params.get("sessionUri");
  const failed = /fail|error|cancel/i.test(params.get("status") ?? "");
  const result =
    project && connectionId && !failed
      ? await finalizeAds(project, connectionId, sessionUri).catch(() => null)
      : null;
  if (project && result?.state === "choose" && result.adConnectionId) {
    const choose = new URL("/ads/choose", request.nextUrl);
    choose.searchParams.set("connection", result.adConnectionId);
    choose.searchParams.set("project", project);
    if (from) choose.searchParams.set("from", from);
    return NextResponse.redirect(choose);
  }
  const back = adsReturn(request, from);
  if (result?.state !== "connected") {
    back.searchParams.set("ads", result?.state === "none" ? "none" : "failed");
  }
  if (project) back.searchParams.set("project", project);
  return NextResponse.redirect(back);
}
