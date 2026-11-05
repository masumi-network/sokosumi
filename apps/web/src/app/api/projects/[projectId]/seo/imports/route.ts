import { NextResponse } from "next/server";
import { z } from "zod";
import { canImportSeoTask } from "@/app/seo/seo-import-model";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import {
  CoreApiRequestError,
  coreClientNoRedirect,
} from "@/lib/clients/core.client";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";

const querySchema = z.object({
  taskId: z.string().min(1).max(128).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
});
const CANDIDATE_PAGE_SIZE = 30;
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
    // Check selected Project authority before returning any import candidates.
    await seoServiceNoRedirect.getWorkspace(projectId);
    if (query.data.taskId) {
      const { data: task } = await coreClientNoRedirect.getTaskById(
        query.data.taskId,
      );
      if (!canImportSeoTask(task, projectId, session.session.user.id))
        return NextResponse.json(
          { error: "Task unavailable" },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      return NextResponse.json(
        { task },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const page = await coreClientNoRedirect.getTasks({
      scope: "owned",
      visibility: "PUBLIC",
      status: ["COMPLETED"],
      limit: CANDIDATE_PAGE_SIZE,
      q: query.data.q,
      cursor: query.data.cursor,
    });
    const tasks = page.data.filter((task) =>
      canImportSeoTask(task, projectId, session.session.user.id),
    );
    return NextResponse.json(
      { tasks, nextCursor: page.meta?.pagination?.nextCursor ?? null },
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
