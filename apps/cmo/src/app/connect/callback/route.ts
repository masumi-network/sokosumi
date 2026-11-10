import { type NextRequest, NextResponse } from "next/server";

import { finalizeChannel } from "../../cmo-actions";

/** Composio sends the founder back here; finish the connection, then resume onboarding. */
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
  const back = new URL("/", request.nextUrl);
  back.searchParams.set("step", "connect");
  const from = params.get("from");
  if (from) back.searchParams.set("from", from);
  if (!connected) back.searchParams.set("connect", "failed");
  return NextResponse.redirect(back);
}
