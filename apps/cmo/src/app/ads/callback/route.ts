import { type NextRequest, NextResponse } from "next/server";

import { finalizeAds } from "../../cmo-actions";

/** Where the founder goes back to: the Accounts step, or Channels in the app. */
function adsReturn(request: NextRequest, from: string | null): URL {
  if (from === "app") return new URL("/channels", request.nextUrl);
  const back = new URL("/", request.nextUrl);
  back.searchParams.set("step", "connect");
  return back;
}

/**
 * Google or Meta sends the founder back here: finish the connection, then
 * return, or let them pick the ad account when the login reaches several.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const connectionId =
    params.get("connectedAccountId") ??
    params.get("connected_account_id") ??
    params.get("connectionId");
  const sessionUri = params.get("session_uri") ?? params.get("sessionUri");
  const failed = /fail|error|cancel/i.test(params.get("status") ?? "");
  const result =
    connectionId && !failed
      ? await finalizeAds(connectionId, sessionUri).catch(() => null)
      : null;
  if (result?.state === "choose" && result.adConnectionId) {
    const choose = new URL("/ads/choose", request.nextUrl);
    choose.searchParams.set("connection", result.adConnectionId);
    if (from) choose.searchParams.set("from", from);
    return NextResponse.redirect(choose);
  }
  const back = adsReturn(request, from);
  if (result?.state !== "connected") {
    back.searchParams.set("ads", result?.state === "none" ? "none" : "failed");
  }
  return NextResponse.redirect(back);
}
