import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import { getEnv } from "@/config/env";
import { upgradeRequired } from "@/helpers/error";

/** `macos/<build>` (ADR 0053). */
export const APPLE_CLIENT_HEADER = "X-Sokosumi-Client";

const MACOS_DOWNLOAD_URL =
  "https://github.com/masumi-network/sokosumi/releases/download/macos-latest/Sokosumi.dmg";

const CLIENT_PATTERN = /^macos\/(\d+)$/;

const UPDATE_MESSAGE = `This version of Sokosumi is out of date. Download the latest version: ${MACOS_DOWNLOAD_URL}`;

/**
 * Answers 426 `client_update_required` to a macOS build older than
 * `MACOS_MINIMUM_BUILD`. Build 1 is the project default, which every
 * published build overrides, so a local build is never gated.
 */
export function appleClientMinimumBuildMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables;
}> {
  return async (c, next) => {
    const match = c.req.header(APPLE_CLIENT_HEADER)?.match(CLIENT_PATTERN);
    const build = match ? Number(match[1]) : null;
    const minimum = getEnv().MACOS_MINIMUM_BUILD;
    if (
      build !== null &&
      build > 1 &&
      minimum !== undefined &&
      build < minimum
    ) {
      throw upgradeRequired(UPDATE_MESSAGE, { kind: "client_update_required" });
    }

    await next();
  };
}
