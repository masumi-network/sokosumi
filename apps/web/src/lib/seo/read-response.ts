import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { canImportSeoTask } from "@/app/seo/seo-import-model";
import { seoFilterQuerySchema } from "@/app/seo/seo-query";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import {
  CoreApiRequestError,
  coreClientNoRedirect,
} from "@/lib/clients/core.client";
import { SEO_VIEWER_HEADER, type SeoOwner } from "@/lib/seo/owner";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";

const CANDIDATE_PAGE_SIZE = 30;
const importsQuerySchema = z.object({
  taskId: z.string().min(1).max(128).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
});

export function requireMatchingSeoViewer(request: Request, userId: string) {
  if (request.headers.get(SEO_VIEWER_HEADER) !== userId)
    throw new CoreApiRequestError("SEO viewer changed", { status: 409 });
}

export async function readSeoResponse(
  request: Request,
  owner: SeoOwner,
  read: (userId: string) => Promise<unknown>,
) {
  const session = await readRouteSession();
  if (session.status === "unavailable")
    return coreSessionUnavailableJson("SEO unavailable", session);
  if (session.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!z.uuid().safeParse(owner.id).success)
    return NextResponse.json(
      { error: "Invalid SEO identifier" },
      { status: 400 },
    );
  try {
    requireMatchingSeoViewer(request, session.session.user.id);
    return NextResponse.json(await read(session.session.user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : error instanceof CoreApiRequestError
          ? (error.status ?? 502)
          : 502;
    return NextResponse.json(
      { error: "SEO unavailable" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export function readSeoWorkspaceResponse(request: Request, owner: SeoOwner) {
  return readSeoResponse(request, owner, async () => {
    const query = seoFilterQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return seoServiceNoRedirect.getWorkspace(owner, query);
  });
}

export function readSeoStatisticsResponse(request: Request, owner: SeoOwner) {
  return readSeoResponse(request, owner, async () => {
    const provider = z
      .enum(["ga4", "search_console"])
      .parse(new URL(request.url).searchParams.get("provider"));
    return seoServiceNoRedirect.statisticsProperties(owner, provider);
  });
}

export function readSeoImportsResponse(request: Request, owner: SeoOwner) {
  return readSeoResponse(request, owner, async (userId) => {
    const query = importsQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    // Check selected Project authority before returning any import candidates.
    // Native audits perform the same authority check against their own workspace owner.
    const workspace = await seoServiceNoRedirect.getWorkspace(owner);
    if (query.taskId) {
      const { data: task } = await coreClientNoRedirect.getTaskById(
        query.taskId,
      );
      if (!canImportSeoTask(task, workspace.projectId, userId))
        throw new CoreApiRequestError("Task unavailable", { status: 404 });
      return { task };
    }
    const page = await coreClientNoRedirect.getTasks({
      scope: "owned",
      visibility: "PUBLIC",
      status: ["COMPLETED"],
      limit: CANDIDATE_PAGE_SIZE,
      ...query,
    });
    return {
      tasks: page.data.filter((task) =>
        canImportSeoTask(task, workspace.projectId, userId),
      ),
      nextCursor: page.meta?.pagination?.nextCursor ?? null,
    };
  });
}
