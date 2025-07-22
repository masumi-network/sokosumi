import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import {
  createApiResponse,
  requireAuth,
  validateParams,
} from "@/lib/api/v1/utils";
import { prisma } from "@/lib/db/repositories";
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

async function updateUserProfile(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  const body = await request.json();
  const updateData = validateParams(UpdateUserSchema, body);

  const updatedUser = await prisma.user.update({
    where: { id: session.user.id },
    data: updateData,
  });

  const userResponse = {
    id: updatedUser.id,
    name: updatedUser.name,
    email: updatedUser.email,
    emailVerified: updatedUser.emailVerified,
    image: updatedUser.image,
    marketingOptIn: updatedUser.marketingOptIn,
    termsAccepted: updatedUser.termsAccepted,
    createdAt: updatedUser.createdAt.toISOString(),
    updatedAt: updatedUser.updatedAt.toISOString(),
  };

  return NextResponse.json(createApiResponse(userResponse));
}

export const GET = createApiRoute(getUserProfile);
export const PATCH = createApiRoute(updateUserProfile);
