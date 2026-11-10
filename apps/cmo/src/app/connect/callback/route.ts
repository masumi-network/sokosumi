import { type NextRequest, NextResponse } from "next/server";

import { connectDonePath } from "../../../lib/connect-window";
import { finalizeChannel } from "../../cmo-actions";

/**
 * Composio sends the founder back here: finish the connection, then resume
 * onboarding, or end Launch's popup on the page that tells Launch.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const connectionId =
    params.get("connectedAccountId") ??
    params.get("connected_account_id") ??
    params.get("connectionId");
  const sessionUri = params.get("session_uri") ?? params.get("sessionUri");
  const failed = /fail|error|cancel/i.test(params.get("status") ?? "");
  // The Project the connect started from; without it nothing is finished.
  const project = params.get("project");
  const connected =
    project && connectionId && !failed
      ? await finalizeChannel(project, connectionId, sessionUri).catch(
          () => false,
        )
      : false;
  const from = params.get("from");
  if (from === "popup") {
    const done = connectDonePath(connected ? "connected" : "failed");
    return NextResponse.redirect(new URL(done, request.nextUrl));
  }
  const back = new URL("/", request.nextUrl);
  back.searchParams.set("step", "connect");
  if (from) back.searchParams.set("from", from);
  if (!connected) back.searchParams.set("connect", "failed");
  if (project) back.searchParams.set("project", project);
  return NextResponse.redirect(back);
}
