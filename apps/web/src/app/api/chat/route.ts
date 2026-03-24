import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { NextRequest } from "next/server";

import { getSession } from "@/lib/auth/utils";
import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json();

    // Forward request to Core API chat endpoint
    const requestHeaders = new Headers(await headers());
    requestHeaders.set("Content-Type", "application/json");
    requestHeaders.delete("Content-Length");

    const response = await fetch(`${getCoreApiBaseUrl()}/conversations/chat`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Handle error responses
      const errorData = await response.json().catch(() => ({
        error: "Internal Server Error",
        message: `Core API returned ${response.status}`,
      }));

      return new Response(JSON.stringify(errorData), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Stream to client; when client cancels (disconnect or stop), drain Core
    // so the backend runs to completion and persists the assistant message.
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
                // Client cancelled — drain Core stream to completion so it persists
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
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
