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
 */
export async function handleSetPassword(c: Context): Promise<Response> {
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
