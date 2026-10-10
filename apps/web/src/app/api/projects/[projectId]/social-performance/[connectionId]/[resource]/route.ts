import { NextResponse } from "next/server";
import { z } from "zod";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { projectService } from "@/lib/services/project.service";

const paramsSchema = z.object({
  projectId: z.string(),
  connectionId: z.uuid(),
  resource: z.enum(["audience", "benchmark", "discovery"]),
});
const audienceQuery = z
  .object({
    kind: z.enum(["followers", "mentions", "likers", "reposters"]).optional(),
    postId: z.uuid().optional(),
    cursor: z.string().max(9000).optional(),
    limit: z.coerce.number().int().min(5).max(100).optional(),
  })
  .refine(
    (value) =>
      (value.kind !== "likers" && value.kind !== "reposters") ||
      Boolean(value.postId),
    { message: "Choose a cached post", path: ["postId"] },
  );
const benchmarkQuery = z.object({
  username: z
    .string()
    .min(1)
    .max(15)
    .regex(/^[A-Za-z0-9_]+$/),
});
const threshold = z.coerce
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .optional();
const discoveryQuery = z
  .object({
    topic: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\p{L}\p{N} #@.,!?'’-]+$/u)
      .optional(),
    username: benchmarkQuery.shape.username.optional(),
    language: z
      .string()
      .regex(/^[a-z]{2,3}$/)
      .optional(),
    format: z
      .enum(["any", "text", "image", "video", "carousel", "link"])
      .optional(),
    publishedFrom: z.iso.datetime({ offset: true }).optional(),
    publishedUntil: z.iso.datetime({ offset: true }).optional(),
    cursor: audienceQuery.shape.cursor,
    limit: z.coerce.number().int().min(10).max(100).optional(),
    sort: z.enum(["recency", "likes", "impressions"]).optional(),
    minLikes: threshold,
    minComments: threshold,
    minShares: threshold,
    minImpressions: threshold,
    minFollowers: threshold,
    maxFollowers: threshold,
  })
  .refine((value) => Boolean(value.topic || value.username), {
    message: "Enter a topic or handle",
  });

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      projectId: string;
      connectionId: string;
      resource: string;
    }>;
  },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable")
    return coreSessionUnavailableJson("Performance unavailable", sessionRead);
  if (sessionRead.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success)
    return NextResponse.json({ error: "Invalid resource" }, { status: 400 });
  const query = Object.fromEntries(new URL(request.url).searchParams);
  try {
    const { projectId, connectionId, resource } = params.data;
    if (resource === "audience") {
      const parsed = audienceQuery.safeParse(query);
      if (!parsed.success)
        return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
      return NextResponse.json(
        await projectService.listSocialPerformanceAudience(
          projectId,
          connectionId,
          parsed.data,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (resource === "discovery") {
      const parsed = discoveryQuery.safeParse(query);
      if (!parsed.success)
        return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
      return NextResponse.json(
        await projectService.listSocialPerformanceDiscovery(
          projectId,
          connectionId,
          {
            ...parsed.data,
            publishedFrom: parsed.data.publishedFrom
              ? new Date(parsed.data.publishedFrom)
              : undefined,
            publishedUntil: parsed.data.publishedUntil
              ? new Date(parsed.data.publishedUntil)
              : undefined,
          },
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const parsed = benchmarkQuery.safeParse(query);
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
    return NextResponse.json(
      await projectService.getSocialPerformanceBenchmark(
        projectId,
        connectionId,
        parsed.data.username,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Performance research unavailable" },
      {
        status:
          error instanceof CoreApiRequestError ? (error.status ?? 502) : 502,
      },
    );
  }
}
