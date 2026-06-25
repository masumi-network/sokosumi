import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/auth.server";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "Unauthorized",
      },
      { status: 401 },
    );
  }

  try {
    const body = await req.text();
    let wantsStream = false;
    try {
      wantsStream = (JSON.parse(body) as { stream?: unknown })?.stream === true;
    } catch {
      wantsStream = false;
    }

    const requestHeaders = buildCoreChatProxyHeaders(
      new Headers(await headers()),
    );
    requestHeaders.set(
      "Content-Type",
      req.headers.get("content-type") ?? "application/json",
    );

    // Streaming opt-in: route to Core's SSE endpoint and pass the event stream
    // straight through (OpenAI chat chunks + `event: hermes.status` frames).
    if (wantsStream) {
      requestHeaders.set("X-Hermes-Progress", "1");
      // Do not forward the browser abort: Core tees the stream and captures the
      // full turn server-side even when the tab closes or the user hits Stop.
      const response = await fetch(
        joinCoreApiPath(getCoreApiBaseUrl(), "/hermes/chat/stream"),
        {
          method: "POST",
          headers: requestHeaders,
          body,
        },
      );

      const contentType = response.headers.get("Content-Type") ?? "";
      // Errors / 409-not-ready come back as JSON — forward them verbatim so the
      // client's existing status handling still works.
      if (
        !response.ok ||
        !response.body ||
        !contentType.includes("event-stream")
      ) {
        const text = await response.text().catch(() => "");
        return new Response(text, {
          status: response.status,
          headers: { "Content-Type": contentType || "application/json" },
        });
      }

      return new Response(response.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const response = await fetch(
      joinCoreApiPath(getCoreApiBaseUrl(), "/hermes/chat"),
      {
        method: "POST",
        headers: requestHeaders,
        body,
      },
    );
    const text = await response.text();

    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { context: "hermes_chat_api" } });
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: "Couldn't reach Hermes. Check your connection.",
      },
      { status: 500 },
    );
  }
}
