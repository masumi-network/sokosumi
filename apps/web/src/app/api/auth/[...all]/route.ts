import type { NextRequest } from "next/server";

import { proxyLegacyCoreAuthRequest } from "@/lib/auth/legacy-core-auth-proxy.server";

interface LegacyAuthRouteContext {
  params: Promise<{
    all: string[];
  }>;
}

async function handleLegacyAuthRequest(
  request: NextRequest,
  context: LegacyAuthRouteContext,
): Promise<Response> {
  const { all } = await context.params;
  return proxyLegacyCoreAuthRequest(request, all);
}

export async function GET(
  request: NextRequest,
  context: LegacyAuthRouteContext,
): Promise<Response> {
  return handleLegacyAuthRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: LegacyAuthRouteContext,
): Promise<Response> {
  return handleLegacyAuthRequest(request, context);
}
