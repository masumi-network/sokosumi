import { APIError } from "better-auth/api";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/auth";

export async function GET(request: NextRequest) {
  try {
    // Get session using Better Auth's API key validation
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Valid API key required" },
        { status: 401 },
      );
    }

    // Return user information
    return NextResponse.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        createdAt: session.user.createdAt,
        updatedAt: session.user.updatedAt,
        termsAccepted: session.user.termsAccepted,
        marketingOptIn: session.user.marketingOptIn,
        stripeCustomerId: session.user.stripeCustomerId,
      },
    });
  } catch (error) {
    console.error("Error in /api/v1/user/me:", error);

    // Handle Better Auth API errors specifically
    if (error instanceof APIError) {
      return NextResponse.json(
        { error: "Unauthorized", message: error.message || "Invalid API key" },
        { status: 401 },
      );
    }

    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: "Failed to retrieve user information",
      },
      { status: 500 },
    );
  }
}
