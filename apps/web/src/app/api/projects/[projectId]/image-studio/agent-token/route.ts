import crypto from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { getEnvSecrets } from "@/config/env.secrets";
import { readRouteSession } from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { projectService } from "@/lib/services/project.service";

/**
 * Mint the short-lived token the browser gives the image-studio agent.
 *
 * A route handler rather than a server action because the browser re-fetches
 * it on a timer while a conversation is open, and Next serializes concurrent
 * server actions per session — a token refresh must not queue behind whatever
 * the person is doing.
 *
 * The token names a user and a project, and it is minted only after Core has
 * confirmed this session can see that project. It is deliberately short-lived
 * and it is not itself permission: the agent presents a derived grant to Core,
 * which re-checks the user's current project membership on every call.
 */

const TTL_SECONDS = 300;
const VERSION = "v1";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const secret = getEnvSecrets().IMAGE_STUDIO_AGENT_SECRET;
  if (!secret) {
    // Not configured is not open. `code` is what lets the chat tell this apart
    // from a momentary failure: this one will not fix itself, so the composer
    // is replaced with an explanation rather than a retry.
    return NextResponse.json(
      {
        code: "not_configured",
        error: "The image studio assistant is not configured.",
      },
      { status: 503 },
    );
  }

  const { projectId } = await params;

  const sessionRead = await readRouteSession();
  if (sessionRead.status === "signedOut") {
    return NextResponse.json(
      { code: "unauthorized", error: "Unauthorized" },
      { status: 401 },
    );
  }
  if (sessionRead.status === "unavailable") {
    return NextResponse.json(
      { code: "temporarily_unavailable", error: "Unavailable" },
      { status: 503, headers: { "Retry-After": "1" } },
    );
  }
  const userId = sessionRead.session.user.id;

  try {
    // Core answers this with the caller's session, so a project this session
    // cannot see is a 404 here and no token is ever minted for it.
    const project = await projectService.getProjectById(projectId);
    if (!project) {
      return NextResponse.json(
        { code: "not_found", error: "Not found" },
        { status: 404 },
      );
    }
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 401) {
      return NextResponse.json(
        { code: "unauthorized", error: "Unauthorized" },
        { status: 401 },
      );
    }
    // Core was asked and could not answer. That is a bad minute, not a broken
    // feature, so it is reported as temporary and carries a retry hint.
    console.error("Failed to mint image studio agent token", error);
    return NextResponse.json(
      { code: "temporarily_unavailable", error: "Unavailable" },
      { status: 503, headers: { "Retry-After": "1" } },
    );
  }

  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = [VERSION, userId, projectId, String(expiresAt)].join(".");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  return NextResponse.json(
    { token: `${payload}.${signature}`, expiresAt },
    { headers: { "cache-control": "no-store" } },
  );
}
