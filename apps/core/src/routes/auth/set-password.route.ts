import { z } from "@hono/zod-openapi";
import { isAPIError } from "better-auth/api";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { auth } from "@/lib/auth.js";

const setPasswordBodySchema = z.object({
  newPassword: z.string().min(1),
});

function invalidRequestBody(c: Context): Response {
  return c.json({ code: "BAD_REQUEST", message: "Invalid request body" }, 400);
}

/**
 * HTTP bridge for Better Auth's server-only `setPassword` API.
 * Better Auth does not register that endpoint on the HTTP router, but Web's
 * server auth client calls `/auth/set-password` when linking a credential account.
 *
 * A direct `auth.api` call skips the router's checks, so the bridge makes them
 * itself: JSON only, and a trusted Origin. The session cookie is sent to every
 * `*.sokosumi.com` host, so without them script on any of those pages could
 * add a password to a signed-in person's account. Web forwards its own origin
 * (`fetchCoreAuth`).
 */
export async function handleSetPassword(c: Context): Promise<Response> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return c.json(
      { code: "UNSUPPORTED_MEDIA_TYPE", message: "Expected a JSON body" },
      415,
    );
  }
  const origin = c.req.header("origin");
  if (!origin || !(await auth.$context).isTrustedOrigin(origin)) {
    return c.json({ code: "INVALID_ORIGIN", message: "Invalid origin" }, 403);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return invalidRequestBody(c);
  }

  const parsed = setPasswordBodySchema.safeParse(raw);
  if (!parsed.success) {
    return invalidRequestBody(c);
  }

  try {
    await auth.api.setPassword({
      body: parsed.data,
      headers: c.req.raw.headers,
    });

    return c.json({ status: true });
  } catch (error) {
    if (isAPIError(error)) {
      const status: ContentfulStatusCode =
        error.statusCode >= 400 && error.statusCode <= 599
          ? (error.statusCode as ContentfulStatusCode)
          : 400;

      return c.json(
        {
          code: error.body?.code ?? error.status,
          message: error.message,
        },
        status,
      );
    }

    throw error;
  }
}
