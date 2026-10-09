import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import { getEnv } from "@/config/env";
import { upgradeRequired } from "@/helpers/error";

/** `macos/<build>` (ADR 0053). */
export const APPLE_CLIENT_HEADER = "X-Sokosumi-Client";

const MACOS_DOWNLOAD_URL =
  "https://github.com/masumi-network/sokosumi/releases/download/macos-latest/Sokosumi.dmg";

// DMG builds from 8033 until #5922 sent `macos-developer-id/`. ponytail:
// drop that form once MACOS_MINIMUM_BUILD reaches the first `macos/` build.
const CLIENT_PATTERN = /^macos(?:-developer-id)?\/(\d+)$/;

// Builds published before the header name themselves only in URLSession's
// default User-Agent.
const LEGACY_USER_AGENT_PATTERN = /^Sokosumi\/(\d+) CFNetwork\//;

// Apple workflow run that published the first DMG (#4849). A lower
// User-Agent build is a local or TestFlight build, so it is never gated.
const FIRST_DMG_BUILD = 3125;

const UPDATE_MESSAGE = `This version of Sokosumi is out of date. Download the latest version: ${MACOS_DOWNLOAD_URL}`;

function parseBuild(
  header: string | undefined,
  userAgent: string | undefined,
): number | null {
  const client = header?.match(CLIENT_PATTERN);
  if (client) {
    return Number(client[1]);
  }
  const legacy = header ? null : userAgent?.match(LEGACY_USER_AGENT_PATTERN);
  if (legacy && Number(legacy[1]) >= FIRST_DMG_BUILD) {
    return Number(legacy[1]);
  }
  return null;
}

/**
 * Answers 426 `client_update_required` to a macOS build older than
 * `MACOS_MINIMUM_BUILD`. Build 1 is the project default, which every
 * published build overrides, so a local build is never gated.
 */
export function appleClientMinimumBuildMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables;
}> {
  return async (c, next) => {
    const build = parseBuild(
      c.req.header(APPLE_CLIENT_HEADER),
      c.req.header("User-Agent"),
    );
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
