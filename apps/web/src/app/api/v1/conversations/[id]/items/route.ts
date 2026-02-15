import { NextRequest, NextResponse } from "next/server";

import { getEnvSecrets } from "@/config/env.secrets";
import { handleApiError } from "@/lib/api";
import { getSession } from "@/lib/auth/utils";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * Add item to conversation
 * @description Adds a message item to a conversation
 * @pathParams ConversationParams
 * @body CreateConversationItemRequest
 * @response ConversationItemSuccessResponse
 * @responseSet public
 * @tag Conversations
 * @auth session
 * @openapi
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Forward request to Core API
    const coreApiUrl = getEnvSecrets().CORE_API_URL;
    const cookieHeader = request.headers.get("cookie");
    const body = await request.text();

    const response = await fetch(`${coreApiUrl}/v1/conversations/${id}/items`, {
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
        errorData || { error: "Failed to add item to conversation" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return handleApiError(error, "add conversation item");
  }
}
