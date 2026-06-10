import "server-only";

import crypto from "node:crypto";

import type { DesignMdOwnerSchemaType } from "@/lib/schemas/design-md";

const JOB_TOKEN_TTL_MS = 60 * 60 * 1000;

function serializeOwner(owner: DesignMdOwnerSchemaType): string {
  return owner.type === "user" ? "user" : `org:${owner.organizationId}`;
}

function signPayload(secret: string, payload: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

export function createDesignMdJobToken(
  secret: string,
  userId: string,
  owner: DesignMdOwnerSchemaType,
  jobId: string,
): string {
  const expiresAt = Date.now() + JOB_TOKEN_TTL_MS;
  const payload = `${userId}|${serializeOwner(owner)}|${jobId}|${expiresAt}`;
  const signature = signPayload(secret, payload);

  return Buffer.from(`${payload}|${signature}`, "utf8").toString("base64url");
}

export function verifyDesignMdJobToken(
  secret: string,
  userId: string,
  owner: DesignMdOwnerSchemaType,
  jobId: string,
  token: string,
): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const separatorIndex = decoded.lastIndexOf("|");
    if (separatorIndex === -1) {
      return false;
    }

    const payload = decoded.slice(0, separatorIndex);
    const signature = decoded.slice(separatorIndex + 1);
    const [tokenUserId, tokenOwner, tokenJobId, expiresAtValue] =
      payload.split("|");

    if (
      tokenUserId !== userId ||
      tokenOwner !== serializeOwner(owner) ||
      tokenJobId !== jobId
    ) {
      return false;
    }

    const expiresAt = Number(expiresAtValue);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      return false;
    }

    const expectedSignature = signPayload(secret, payload);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
