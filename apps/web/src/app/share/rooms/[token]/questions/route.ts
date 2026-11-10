import {
  getShareRoomsByTokenQuestions,
  postShareRoomsByTokenQuestions,
} from "@sokosumi/core-client";
import { createClient } from "@sokosumi/core-client/client";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import {
  DATA_ROOM_SESSION_COOKIE,
  DATA_ROOM_SESSION_HEADER,
} from "@/lib/services/data-room-viewer.server";

async function roomClient() {
  const session = (await cookies()).get(DATA_ROOM_SESSION_COOKIE)?.value;
  return createClient({
    baseUrl: getServerCoreApiBaseUrl(),
    headers: session ? { [DATA_ROOM_SESSION_HEADER]: session } : {},
  });
}

/** The viewer's own questions, about one document when one is named. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const resourceId = request.nextUrl.searchParams.get("resourceId");
  const { data, response } = await getShareRoomsByTokenQuestions({
    client: await roomClient(),
    path: { token },
    query: resourceId ? { resourceId } : {},
  });
  if (!data)
    return NextResponse.json(
      { error: "unavailable" },
      { status: response?.status ?? 503 },
    );
  return NextResponse.json(data.data);
}

/** Asks the room's owner about a document. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as {
    resourceId?: unknown;
    body?: unknown;
  } | null;
  if (typeof body?.resourceId !== "string" || typeof body?.body !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { data, response } = await postShareRoomsByTokenQuestions({
    client: await roomClient(),
    path: { token },
    body: { resourceId: body.resourceId, body: body.body },
  });
  if (!data)
    return NextResponse.json(
      { error: "unavailable" },
      { status: response?.status ?? 503 },
    );
  return NextResponse.json(data.data, { status: 201 });
}
