import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import { getEnv } from "@/config/env";
import { upgradeRequired } from "@/helpers/error";

/** `macos-developer-id/<build>` or `macos-app-store/<build>` (ADR 0053). */
export const APPLE_CLIENT_HEADER = "X-Sokosumi-Client";

export const MACOS_DOWNLOAD_URL =
  "https://github.com/masumi-network/sokosumi/releases/download/apple-latest/Sokosumi.dmg";

type MacOSChannel = "developer-id" | "app-store";

const CLIENT_PATTERN = /^macos-(developer-id|app-store)\/(\d+)$/;

// Builds published before the header name themselves only in URLSession's
// default User-Agent, without a channel.
const LEGACY_USER_AGENT_PATTERN = /^Sokosumi\/(\d+) CFNetwork\//;

// Apple workflow run that published the first DMG (#4849). A lower
// User-Agent build is a local or Xcode Cloud build, so it is never gated.
const FIRST_DEVELOPER_ID_BUILD = 3125;

const UPDATE_MESSAGES: Record<MacOSChannel, string> = {
  "developer-id": `This version of Sokosumi is out of date. Download the latest version: ${MACOS_DOWNLOAD_URL}`,
  "app-store":
    "This version of Sokosumi is out of date. Update it from the App Store or TestFlight.",
};

function parseClient(
  header: string | undefined,
  userAgent: string | undefined,
): { channel: MacOSChannel; build: number } | null {
  const client = header?.match(CLIENT_PATTERN);
  if (client) {
    return { channel: client[1] as MacOSChannel, build: Number(client[2]) };
  }
  const legacy = header ? null : userAgent?.match(LEGACY_USER_AGENT_PATTERN);
  if (legacy && Number(legacy[1]) >= FIRST_DEVELOPER_ID_BUILD) {
    return { channel: "developer-id", build: Number(legacy[1]) };
  }
  return null;
}

/**
 * Answers 426 `client_update_required` to a macOS build older than its
 * channel's minimum. Build 1 is the project default, which every published
 * build overrides, so a local build is never gated.
 */
export function appleClientMinimumBuildMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables;
}> {
  return async (c, next) => {
    const client = parseClient(
      c.req.header(APPLE_CLIENT_HEADER),
      c.req.header("User-Agent"),
    );
    if (client && client.build > 1) {
      const env = getEnv();
      const minimum =
        client.channel === "developer-id"
          ? env.MACOS_DEVELOPER_ID_MINIMUM_BUILD
          : env.MACOS_APP_STORE_MINIMUM_BUILD;
      if (minimum !== undefined && client.build < minimum) {
        throw upgradeRequired(UPDATE_MESSAGES[client.channel], {
          kind: "client_update_required",
        });
      }
    }

    await next();
  };
}
