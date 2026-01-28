import { NextRequest, NextResponse } from "next/server";

import { getEnvSecrets } from "@/config/env.secrets";
import { handleApiError } from "@/lib/api";
import { getSession } from "@/lib/auth/utils";

/**
 * List conversations
 * @description Retrieves all conversations for the authenticated user
 * @response ConversationsSuccessResponse
 * @responseSet public
 * @tag Conversations
 * @auth session
 * @openapi
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Forward request to Core API
    const coreApiUrl = getEnvSecrets().CORE_API_URL;
    const cookieHeader = request.headers.get("cookie");
    const targetUrl = `${coreApiUrl}/v1/conversations`;

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      let errorData = {};
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { raw: errorText };
      }
      return NextResponse.json(
        errorData || { error: "Failed to fetch conversations" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error, "retrieve conversations");
  }
}

/**
 * Create conversation
 * @description Creates a new conversation
 * @body CreateConversationRequest
 * @response ConversationSuccessResponse
 * @responseSet public
 * @tag Conversations
 * @auth session
 * @openapi
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Forward request to Core API
    const coreApiUrl = getEnvSecrets().CORE_API_URL;
    const cookieHeader = request.headers.get("cookie");
    const body = await request.text();

    const response = await fetch(`${coreApiUrl}/v1/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        errorData || { error: "Failed to create conversation" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return handleApiError(error, "create conversation");
  }
}
