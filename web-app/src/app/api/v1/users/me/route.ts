import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import { createApiResponse, requireAuth } from "@/lib/api/v1/utils";
import { retrieveUserById } from "@/lib/db/repositories/user";

async function getUserProfile(_request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  const user = await retrieveUserById(session.user.id);

  if (!user) {
    throw new Error("User not found");
  }

  const userResponse = {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    marketingOptIn: user.marketingOptIn,
    termsAccepted: user.termsAccepted,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };

  return NextResponse.json(createApiResponse(userResponse));
}

export const GET = createApiRoute(getUserProfile);
