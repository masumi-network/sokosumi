import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { createMiddleware } from "hono/factory";

import { getEnv } from "@/config/env";
import { forbidden } from "@/helpers/error";
import type { AuthEnv } from "@/middleware/auth";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A `/v1/cmo/**` write needs CMO's app: an OAuth token whose client is
 * `CMO_OAUTH_CLIENT_ID` (ADR 0066). A redirect-URI match is not enough, as
 * anyone signed in can register a client with CMO's callback. Unset, every
 * write is refused. Reads stay open to members.
 */
export const cmoClientCheck = createMiddleware<AuthEnv>(async (c, next) => {
  if (!READ_METHODS.has(c.req.method)) {
    const cmoClientId = getEnv().CMO_OAUTH_CLIENT_ID;
    const { authContext } = c.var;
    const fromCmo =
      cmoClientId !== undefined &&
      authContext.actor === "user" &&
      authContext.authenticationMethod === "oauth" &&
      authContext.oauthClientId === cmoClientId;
    if (!fromCmo) {
      throw forbidden("Only CMO may make this change.", {
        kind: CORE_API_ERROR_KINDS.CMO_CLIENT_REQUIRED,
      });
    }
  }
  await next();
});
