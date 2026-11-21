import { getCmoPictureImageForProject } from "@sokosumi/core-client";
import { type NextRequest, NextResponse } from "next/server";

import { coreForCurrentUser } from "../../../lib/core";

/**
 * One of Cuso's pictures, chosen or not, for the Pictures page:
 * `/api/pictures?project=<Project id>&job=<picture id>`. The originals stay
 * private in Core; this passes Core's preview to the signed-in person only.
 */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project");
  const jobId = request.nextUrl.searchParams.get("job");
  if (!projectId || !jobId)
    return NextResponse.json({ message: "Name the picture" }, { status: 400 });
  const core = await coreForCurrentUser();
  if (!core)
    return NextResponse.json({ message: "Not signed in" }, { status: 401 });
  const { data, response } = await getCmoPictureImageForProject({
    ...core,
    path: { projectId, jobId },
    parseAs: "blob",
  });
  if (!data || !response?.ok)
    return NextResponse.json(
      { message: "No such picture" },
      { status: response?.status ?? 502 },
    );
  return new NextResponse(data as Blob, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
