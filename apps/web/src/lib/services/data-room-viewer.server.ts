import "server-only";

import {
  type DataRoomView,
  getShareRoomsByToken,
  postShareRoomsByTokenCode,
  postShareRoomsByTokenSession,
} from "@sokosumi/core-client";
import { createClient } from "@sokosumi/core-client/client";
import { cache } from "react";

import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

/** The cookie a browser keeps once it signed in to a data room. */
export const DATA_ROOM_SESSION_COOKIE = "data_room_session";
/** Core's header for that session. */
export const DATA_ROOM_SESSION_HEADER = "x-data-room-session";
/** As long as Core keeps a session; a revoke ends it sooner. */
export const DATA_ROOM_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** The room's own path, which the session cookie is scoped to. */
export function dataRoomPath(token: string): string {
  return `/share/rooms/${encodeURIComponent(token)}`;
}

/** A public read: no viewer cookies, only the room's own session. */
function roomClient(session: string | undefined) {
  return createClient({
    baseUrl: getServerCoreApiBaseUrl(),
    headers: session ? { [DATA_ROOM_SESSION_HEADER]: session } : {},
  });
}

/** The room as this browser may see it, or null when there is no such room. */
export const readDataRoom = cache(
  async (
    token: string,
    session: string | undefined,
  ): Promise<DataRoomView | null> => {
    const { data, response } = await getShareRoomsByToken({
      client: roomClient(session),
      path: { token },
    });
    if (response?.status === 404 || !data) return null;
    return data.data;
  },
);

export type DataRoomCodeResult = "sent" | "closed" | "missing";

export async function requestDataRoomCode(
  token: string,
  email: string,
): Promise<DataRoomCodeResult> {
  const { response } = await postShareRoomsByTokenCode({
    client: roomClient(undefined),
    path: { token },
    body: { email },
  });
  if (response?.status === 204) return "sent";
  return response?.status === 410 ? "closed" : "missing";
}

export type DataRoomSignInResult =
  | { ok: true; session: string }
  | { ok: false; reason: "wrong" | "closed" | "missing" };

export async function signInToDataRoom(
  token: string,
  email: string,
  code: string,
): Promise<DataRoomSignInResult> {
  const { data, response } = await postShareRoomsByTokenSession({
    client: roomClient(undefined),
    path: { token },
    body: { email, code },
  });
  if (data) return { ok: true, session: data.data.session };
  return {
    ok: false,
    reason:
      response?.status === 401
        ? "wrong"
        : response?.status === 410
          ? "closed"
          : "missing",
  };
}

/**
 * Streams one of Core's room responses (a file, the zip, the logo) to the
 * browser with the room session attached, keeping Core's headers that
 * protect the bytes and nothing that describes Core.
 */
export async function proxyDataRoomBytes(
  corePath: string,
  session: string | undefined,
): Promise<Response> {
  const base = getServerCoreApiBaseUrl().replace(/\/$/, "");
  const upstream = await fetch(`${base}${corePath}`, {
    headers: session ? { [DATA_ROOM_SESSION_HEADER]: session } : {},
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    const body = (await upstream.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    return Response.json(
      {
        error: typeof body?.message === "string" ? body.message : "Unavailable",
      },
      {
        status: [401, 403, 404, 410, 413].includes(upstream.status)
          ? upstream.status
          : 503,
      },
    );
  }
  const headers = new Headers({
    "cache-control":
      upstream.headers.get("cache-control") ?? "private, no-store",
    "x-content-type-options": "nosniff",
  });
  for (const name of [
    "content-type",
    "content-length",
    "content-disposition",
    "content-security-policy",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
