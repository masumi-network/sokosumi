import {
  checkCmoTestCopyForProject,
  tearDownCmoTestCopyForProject,
} from "@sokosumi/core-client";
import { type NextRequest, NextResponse } from "next/server";

import { coreForCurrentUser } from "../../../lib/core";

/**
 * A test copy's check (GET) and teardown (POST), for the signed-in tester:
 * `/api/test-copy?project=<the copy's Project id>` answers Core's own JSON
 * and status. CMO's daily flow test calls both from its browser session.
 */
async function forward(
  request: NextRequest,
  call:
    | typeof checkCmoTestCopyForProject
    | typeof tearDownCmoTestCopyForProject,
) {
  const projectId = request.nextUrl.searchParams.get("project");
  if (!projectId) {
    return NextResponse.json({ message: "Name the project" }, { status: 400 });
  }
  const core = await coreForCurrentUser();
  if (!core) {
    return NextResponse.json({ message: "Not signed in" }, { status: 401 });
  }
  const { data, error, response } = await call({
    ...core,
    path: { projectId },
  });
  return NextResponse.json(data ? data.data : error, {
    status: response?.status ?? 502,
  });
}

export function GET(request: NextRequest) {
  return forward(request, checkCmoTestCopyForProject);
}

export function POST(request: NextRequest) {
  return forward(request, tearDownCmoTestCopyForProject);
}
