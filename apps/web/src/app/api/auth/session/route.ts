import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/utils";

export async function GET() {
  const session = await getSession({ refresh: true });

  if (!session) {
    return NextResponse.json({ session: null }, { status: 401 });
  }

  return NextResponse.json({ session });
}
