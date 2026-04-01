import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/utils";
import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { isNewChatExperimentalAllowedEmail } from "@/lib/flags/new-chat-experimental";

export const CORE_LEGACY_CHAT_STREAM_PATH = "conversations/chat" as const;
export const CORE_NEW_CHAT_STREAM_PATH = "conversations/new-chat" as const;

export type CoreConversationChatStreamPath =
  | typeof CORE_LEGACY_CHAT_STREAM_PATH
  | typeof CORE_NEW_CHAT_STREAM_PATH;

export async function proxyConversationChatPost(
  req: NextRequest,
  options: {
    coreRelativePath: CoreConversationChatStreamPath;
    sentryContext: string;
  },
) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (
    options.coreRelativePath === CORE_NEW_CHAT_STREAM_PATH &&
    !isNewChatExperimentalAllowedEmail(session.user?.email)
  ) {
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

    const response = await fetch(
      `${getCoreApiBaseUrl()}/${options.coreRelativePath}`,
      {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(body),
      },
    );

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
        context: options.sentryContext,
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
