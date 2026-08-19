import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import * as z from "zod";

import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

const idsSchema = z.array(z.string().trim().min(1).max(64)).min(1).max(20);

/**
 * Narrow poll used while a Soko Bot turn is active. A Route Handler (not a
 * server action) so background polling never contends with the user's own
 * server actions (send/accept), which Next serializes per session.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = idsSchema.safeParse(
    request.nextUrl.searchParams
      .getAll("id")
      .flatMap((value) => value.split(",").filter(Boolean)),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid turn ids" }, { status: 400 });
  }
  try {
    const snapshots = await sokoBotService.getTurnStatuses(parsed.data);
    return NextResponse.json(
      { snapshots },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "Status unavailable" }, { status });
  }
}
