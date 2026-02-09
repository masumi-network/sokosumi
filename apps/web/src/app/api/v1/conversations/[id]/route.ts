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
 * Get conversation
 * @description Retrieves a specific conversation by ID
 * @pathParams ConversationParams
 * @response ConversationSuccessResponse
 * @responseSet public
 * @tag Conversations
 * @auth session
 * @openapi
 */
export async function GET(
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

    const response = await fetch(`${coreApiUrl}/v1/conversations/${id}`, {
      method: "GET",
      headers: {
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        errorData || { error: "Failed to fetch conversation" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error, "retrieve conversation");
  }
}

/**
 * Update conversation
 * @description Updates conversation metadata
 * @pathParams ConversationParams
 * @body UpdateConversationRequest
 * @response ConversationSuccessResponse
 * @responseSet public
 * @tag Conversations
 * @auth session
 * @openapi
 */
export async function PATCH(
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

    const response = await fetch(`${coreApiUrl}/v1/conversations/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        errorData || { error: "Failed to update conversation" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error, "update conversation");
  }
}

/**
 * Archive conversation
 * @description Archives or unarchives a conversation
 * @pathParams ConversationParams
 * @body ArchiveConversationRequest
 * @response ConversationSuccessResponse
 * @responseSet public
 * @tag Conversations
 * @auth session
 * @openapi
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Forward request to Core API archive endpoint
    const coreApiUrl = getEnvSecrets().CORE_API_URL;
    const cookieHeader = request.headers.get("cookie");

    const response = await fetch(
      `${coreApiUrl}/v1/conversations/${id}/archive`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: JSON.stringify({ archived: true }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        errorData || { error: "Failed to archive conversation" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error, "archive conversation");
  }
}
