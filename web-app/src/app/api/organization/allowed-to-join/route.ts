import { NextRequest, NextResponse } from "next/server";

import {
  retrieveOrganizationsByEmailDomain,
  retrieveOrganizationWithRelationsById,
} from "@/lib/db/repositories/organization";
import { getEmailDomain } from "@/lib/utils/email";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email || typeof email !== "string") {
    return NextResponse.json({ message: "Email is required" }, { status: 400 });
  }
  if (email.length === 0) {
    return NextResponse.json({
      allowedOrganizations: [],
    });
  }

  const organizationId = req.nextUrl.searchParams.get("organizationId");
  if (!organizationId && typeof organizationId !== "string") {
    return NextResponse.json(
      { message: "Organization ID is required" },
      { status: 400 },
    );
  }

  if (organizationId && organizationId.length > 0) {
    const organization =
      await retrieveOrganizationWithRelationsById(organizationId);
    if (!organization) {
      return NextResponse.json({
        allowedOrganizations: [],
      });
    }
    return NextResponse.json({
      allowedOrganizations: [organization],
    });
  }

  const emailDomain = getEmailDomain(email);
  if (!emailDomain) {
    return NextResponse.json({
      allowedOrganizations: [],
    });
  }

  const allowedOrganizations =
    await retrieveOrganizationsByEmailDomain(emailDomain);
  return NextResponse.json({
    allowedOrganizations,
  });
}
