import { type NextRequest, NextResponse } from "next/server";

import { finalizeChannel } from "../../cmo-actions";

/** Composio sends the founder back here; finish the connection, then resume onboarding. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const connectionId =
    params.get("connectedAccountId") ??
    params.get("connected_account_id") ??
    params.get("connectionId");
  const failed = /fail|error|cancel/i.test(params.get("status") ?? "");
  const connected =
    connectionId && !failed
      ? await finalizeChannel(connectionId).catch(() => false)
      : false;
  const back = new URL("/", request.nextUrl);
  back.searchParams.set("step", "connect");
  if (!connected) back.searchParams.set("connect", "failed");
  return NextResponse.redirect(back);
}
