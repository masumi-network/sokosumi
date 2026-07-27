import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { getSession } from "@/lib/auth/auth.server";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

const CORE_CHAT_STREAM_PATH = "chats/stream" as const;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { conversationId } = await context.params;
  if (!conversationId?.trim()) {
    return new Response(null, { status: 400 });
  }

  try {
    const requestHeaders = buildCoreChatProxyHeaders(
      new Headers(await headers()),
    );

    const coreUrl = `${getCoreApiBaseUrl()}/${CORE_CHAT_STREAM_PATH}/${encodeURIComponent(conversationId)}`;

    const response = await fetch(coreUrl, {
      method: "GET",
      headers: requestHeaders,
    });

    if (response.status === 204) {
      return new Response(null, { status: 204 });
    }

    if (!response.ok) {
      const text = await response.text();
      return new Response(text, {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("Content-Type") ?? "application/json",
        },
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
            } catch {}
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
      tags: { context: "chat_api_stream_resume" },
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
