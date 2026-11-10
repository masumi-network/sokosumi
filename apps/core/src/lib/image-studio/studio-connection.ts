import { randomBytes } from "node:crypto";

import { getBetterAuthPublicBaseUrl } from "@/config/env";
import { unauthorized } from "@/helpers/error";
import { hashApiKey } from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import { requireProjectAccessForUser } from "@/lib/image-studio/access";
import {
  BEARER_USER_SELECT,
  isActiveUser,
} from "@/middleware/auth-active-user";

const CONNECTION_TTL_MS = 60 * 60 * 1000;
export const STUDIO_MCP_PATH = "/image-studio-mcp";

type ConnectionOwner = { projectId: string; userId: string };

function serverUrl() {
  return new URL(`/v1${STUDIO_MCP_PATH}`, getBetterAuthPublicBaseUrl()).href;
}

export async function readStudioConnection(owner: ConnectionOwner) {
  const connection = await prisma.projectStudioConnection.findUnique({
    where: { projectId_userId: owner },
    select: { expiresAt: true },
  });
  const expiresAt = connection?.expiresAt;
  return {
    url: serverUrl(),
    expiresAt:
      expiresAt && expiresAt > new Date() ? expiresAt.toISOString() : null,
  };
}

export async function createStudioConnection(owner: ConnectionOwner) {
  const url = serverUrl();
  const token = `studio_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + CONNECTION_TTL_MS);
  const credential = { keyHash: await hashApiKey(token), expiresAt };
  await prisma.projectStudioConnection.upsert({
    where: { projectId_userId: owner },
    create: { ...owner, ...credential },
    update: credential,
    select: { expiresAt: true },
  });
  return { url, token, expiresAt: expiresAt.toISOString() };
}

export async function revokeStudioConnection(owner: ConnectionOwner) {
  await prisma.projectStudioConnection.deleteMany({ where: owner });
}

export async function requireStudioConnection(request: Request) {
  const credential = /^Bearer (studio_[\w-]{43})$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  const error = unauthorized("A valid Studio connection token is required.");
  if (!credential) throw error;
  const now = new Date();
  const connection = await prisma.projectStudioConnection.findUnique({
    where: { keyHash: await hashApiKey(credential), expiresAt: { gt: now } },
    select: {
      projectId: true,
      userId: true,
      user: { select: BEARER_USER_SELECT },
    },
  });
  if (!connection || !isActiveUser(connection.user, now)) throw error;
  return requireProjectAccessForUser({
    projectId: connection.projectId,
    userId: connection.userId,
  });
}
