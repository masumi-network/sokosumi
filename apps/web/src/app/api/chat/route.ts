import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/auth.server";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

const CORE_CHAT_PATH = "chat" as const;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId?.trim()) {
    return NextResponse.json(
      {
        error: "Bad Request",
        message: "Query parameter conversationId is required.",
      },
      { status: 400 },
    );
  }

  try {
    const requestHeaders = buildCoreChatProxyHeaders(
      new Headers(await headers()),
    );

    const incoming = new URL(req.url);
    const coreSearch = new URLSearchParams(incoming.search);
    coreSearch.set("conversationId", conversationId);

    const coreUrl = `${getCoreApiBaseUrl()}/${CORE_CHAT_PATH}?${coreSearch.toString()}`;

    const response = await fetch(coreUrl, {
      method: "GET",
      headers: requestHeaders,
    });

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "chat_api_get" },
    });
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: "An unexpected error occurred.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json();

    const requestHeaders = buildCoreChatProxyHeaders(
      new Headers(await headers()),
    );
    requestHeaders.set("Content-Type", "application/json");

    const response = await fetch(`${getCoreApiBaseUrl()}/${CORE_CHAT_PATH}`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: "Internal Server Error",
        message: `Core API returned ${response.status}`,
      }));

      return new Response(JSON.stringify(errorData), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const coreStream = response.body;
    if (!coreStream) {
      return new Response(null, {
        status: response.status,
        headers: response.headers,
      });
    }
    const stream = new ReadableStream({
      start(controller) {
        const reader = coreStream.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                return;
              }
              try {
                controller.enqueue(value);
              } catch {
                while (true) {
                  const { done: drained } = await reader.read();
                  if (drained) break;
                }
                return;
              }
            }
          } catch (err) {
            try {
              controller.error(err);
            } catch {
              // already closed
            }
          }
        })();
      },
    });
    return new Response(stream, {
      headers: response.headers,
      status: response.status,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        context: "chat_api",
      },
    });
    // Do not leak error/stack details to the client (js/stack-trace-exposure);
    // the full error is already reported to Sentry above.
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
