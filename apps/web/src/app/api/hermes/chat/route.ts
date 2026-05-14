import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/utils";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

const CORE_HERMES_CHAT_PATH = "hermes/chat" as const;

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
    const requestHeaders = buildCoreChatProxyHeaders(
      new Headers(await headers()),
    );
    requestHeaders.set(
      "Content-Type",
      req.headers.get("content-type") ?? "application/json",
    );

    const response = await fetch(
      `${getCoreApiBaseUrl()}/${CORE_HERMES_CHAT_PATH}`,
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
