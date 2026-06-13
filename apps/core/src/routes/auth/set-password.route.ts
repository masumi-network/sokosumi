import { isAPIError } from "better-auth/api";
import type { Context } from "hono";
import * as z from "zod";

import { auth } from "@/lib/auth.js";

const setPasswordBodySchema = z.object({
  newPassword: z.string(),
});

/**
 * HTTP bridge for Better Auth's server-only `setPassword` API.
 * Better Auth does not register that endpoint on the HTTP router, but Web's
 * server auth client calls `/auth/set-password` when linking a credential account.
 */
export async function handleSetPassword(c: Context): Promise<Response> {
  try {
    const body = setPasswordBodySchema.parse(await c.req.json());

    await auth.api.setPassword({
      body,
      headers: c.req.raw.headers,
    });

    return c.json({ status: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        { code: "BAD_REQUEST", message: "Invalid request body" },
        400,
      );
    }

    if (isAPIError(error)) {
      return c.json(
        {
          code: error.body?.code ?? error.status,
          message: error.message,
        },
        error.statusCode,
      );
    }

    throw error;
  }
}
