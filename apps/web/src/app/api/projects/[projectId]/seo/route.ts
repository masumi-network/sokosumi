import { NextResponse } from "next/server";
import { z } from "zod";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";

const querySchema = z
  .object({
    scopeId: z.uuid().optional(),
    pageId: z.uuid().optional(),
    // Web uses saved groups for multiple pages. Never drop Core explicit-page filters.
    pageIds: z.never().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    channel: z.enum(["all", "organic"]).optional(),
  })
  .refine((query) => !(query.scopeId && query.pageId))
  .refine((query) => !query.from || !query.to || query.from <= query.to);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await readRouteSession();
  if (session.status === "unavailable")
    return coreSessionUnavailableJson("SEO unavailable", session);
  if (session.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!z.uuid().safeParse(projectId).success || !query.success)
    return NextResponse.json({ error: "Invalid SEO filters" }, { status: 400 });
  try {
    return NextResponse.json(
      await seoServiceNoRedirect.getWorkspace(projectId, query.data),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError ? (error.status ?? 502) : 502;
    return NextResponse.json(
      { error: "SEO unavailable" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
