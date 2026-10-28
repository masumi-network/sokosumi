import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { newsletterIssueInputSchema } from "@/lib/schemas/newsletter-issues";
import { newsletterService } from "@/lib/services/newsletter.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const t = await getTranslations("App.Projects.Newsletter.Issues");
  const session = await readRouteSession();
  if (session.status === "unavailable")
    return coreSessionUnavailableJson(t("Preview.error"), session);
  if (session.status === "signedOut")
    return NextResponse.json({ error: t("Preview.error") }, { status: 401 });
  const { projectId } = await params;
  const input = newsletterIssueInputSchema(t).safeParse(
    await request.json().catch(() => null),
  );
  if (!z.uuid().safeParse(projectId).success || !input.success)
    return NextResponse.json({ error: t("invalid") }, { status: 422 });
  try {
    const preview = await newsletterService.previewIssue(projectId, input.data);
    return NextResponse.json(preview, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError ? error.status || 502 : 502;
    return NextResponse.json({ error: t("Preview.error") }, { status });
  }
}
