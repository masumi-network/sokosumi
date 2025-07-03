import { NextRequest, NextResponse } from "next/server";

import { retrieveOrganizationsByEmailDomain } from "@/lib/db/repositories/organization";
import { getEmailDomain } from "@/lib/utils/email";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email || typeof email !== "string") {
    return NextResponse.json({ message: "Email is required" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({
      allowedOrganizations: [],
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
