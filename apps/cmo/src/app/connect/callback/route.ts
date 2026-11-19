import { type NextRequest, NextResponse } from "next/server";

import {
  type ChannelFinalized,
  type ChannelSignIn,
  finalizeChannel,
  keepChannelSignIn,
} from "../../cmo-actions";

/**
 * The provider sends the founder back here; finish the connection, then
 * resume onboarding. TikTok and LinkedIn come back at `/zernio/callback`,
 * which is this same handler, with `connection` and a one-use `proof`. A
 * sign-in that reaches several accounts goes on to the picker.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const connectionId =
    params.get("connectedAccountId") ??
    params.get("connected_account_id") ??
    params.get("connectionId") ??
    params.get("connection");
  const failed =
    /fail|error|cancel/i.test(params.get("status") ?? "") ||
    params.has("error");
  // The Project the connect started from; without it nothing is finished.
  const project = params.get("project");
  const from = params.get("from");
  const signIn: ChannelSignIn | null =
    connectionId && !failed
      ? {
          connectionId,
          sessionUri: params.get("session_uri") ?? params.get("sessionUri"),
          callbackProof: params.get("proof"),
          pendingDataToken: params.get("pendingDataToken"),
          connectToken: params.get("connect_token"),
        }
      : null;
  const result: ChannelFinalized =
    project && signIn
      ? await finalizeChannel(project, signIn).catch(
          (): ChannelFinalized => ({ state: "failed", reason: "failed" }),
        )
      : { state: "failed", reason: "failed" };
  if (project && signIn && result.state === "choose") {
    // The session is redeemed by now; the picker finishes without it.
    await keepChannelSignIn({
      project,
      from,
      signIn: { ...signIn, sessionUri: null },
    });
    return NextResponse.redirect(new URL("/connect/choose", request.nextUrl));
  }
  const back = new URL("/", request.nextUrl);
  back.searchParams.set("step", "connect");
  if (from) back.searchParams.set("from", from);
  if (result.state === "failed") {
    back.searchParams.set("connect", result.reason);
  }
  if (project) back.searchParams.set("project", project);
  return NextResponse.redirect(back);
}
