import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import { createApiResponse, requireAuth } from "@/lib/api/v1/utils";
import { MemberWithOrganization } from "@/lib/db";
import { listMyMembers } from "@/lib/services/organization";

function mapOrganizationToResponse(member: MemberWithOrganization) {
  return {
    id: member.organization.id,
    name: member.organization.name,
    slug: member.organization.slug,
    requiredEmailDomains: member.organization.requiredEmailDomains,
  };
}

async function getOrganizations(_request: NextRequest): Promise<NextResponse> {
  await requireAuth();

  const members = await listMyMembers();
  const organizations = members.map(mapOrganizationToResponse);

  return NextResponse.json(createApiResponse(organizations));
}

export const GET = createApiRoute(getOrganizations);
