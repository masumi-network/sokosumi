import { NextResponse } from "next/server";

import {
  CoreApiRequestError,
  coreClientNoRedirect,
} from "@/lib/clients/core.client";

/** Background reads bypass the server action queue; Core authenticates the caller. */
export async function GET() {
  try {
    const badgeCampaigns = await coreClientNoRedirect.getMyBadgeCampaigns();
    return NextResponse.json(
      { data: { badgeCampaigns }, meta: { timestamp: new Date() } },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json(
      { error: "Badge campaigns unavailable" },
      { status },
    );
  }
}
