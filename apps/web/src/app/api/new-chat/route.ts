import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/utils";
import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { isNewChatExperimentalAllowedEmail } from "@/lib/flags/new-chat-experimental";

/** Core `POST /v1/chat` (Vercel AI SDK + `@sokosumi/ai-provider`). */
const CORE_CHAT_PATH = "chat" as const;

/** BFF for Core `GET /v1/chat` (AI SDK message history). */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!isNewChatExperimentalAllowedEmail(session.user?.email)) {
    return NextResponse.json(
      {
        error: "Forbidden",
        message: "New chat experimental is not available for this account.",
      },
      { status: 403 },
    );
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
    const requestHeaders = new Headers(await headers());
    requestHeaders.delete("Content-Length");

    const coreUrl = `${getCoreApiBaseUrl()}/${CORE_CHAT_PATH}?${new URLSearchParams({ conversationId })}`;

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
      tags: { context: "new_chat_api_get" },
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

/**
 * BFF for Core `POST /v1/chat` (streams SSE). Forwards cookies/org headers; drains Core
 * when the client disconnects (same pattern as `api/chat/route.ts`).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!isNewChatExperimentalAllowedEmail(session.user?.email)) {
    return NextResponse.json(
      {
        error: "Forbidden",
        message: "New chat experimental is not available for this account.",
      },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();

    const requestHeaders = new Headers(await headers());
    requestHeaders.set("Content-Type", "application/json");
    requestHeaders.delete("Content-Length");

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
        context: "new_chat_api",
      },
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
