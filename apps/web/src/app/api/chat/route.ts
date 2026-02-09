import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { NextRequest } from "next/server";

import { getEnvSecrets } from "@/config/env.secrets";
import { getSession } from "@/lib/auth/utils";
import { buildAuthHeaders } from "@/lib/clients/core.client";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json();

    // Forward request to Core API chat endpoint
    const coreApiUrl = getEnvSecrets().CORE_API_URL;
    const requestHeaders = await headers();
    const authHeaders = buildAuthHeaders(requestHeaders);

    const response = await fetch(`${coreApiUrl}/v1/conversations/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
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

    // Return streaming response as-is
    return new Response(response.body, {
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
