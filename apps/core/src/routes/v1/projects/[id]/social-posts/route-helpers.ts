import { HTTPException } from "hono/http-exception";

import { internalServerError } from "@/helpers/error";

export function mapSocialPostServiceError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  throw internalServerError("Unable to manage social posts.");
}
