import { NextResponse } from "next/server";

import { getEnvPublicConfig } from "@/config/env.public";

export const dynamic = "force-dynamic";

export async function GET() {
  const version = getEnvPublicConfig().NEXT_PUBLIC_APP_VERSION ?? "dev";
  return NextResponse.json(
    { version },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
