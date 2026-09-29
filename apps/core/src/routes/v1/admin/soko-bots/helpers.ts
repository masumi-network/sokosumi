import { z } from "@hono/zod-openapi";
import {
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { sokoBotVersionDetailSchema } from "@/schemas/soko-bot.schema";
import { SokoBotBillingAccessError } from "@/services/soko-bot-billing.service";
import {
  SokoBotBusyError,
  SokoBotIdempotencyConflictError,
  SokoBotNotFoundError,
  SokoBotRetryableStartError,
  SokoBotStartAbortedError,
  SokoBotValidationError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";

export const sokoBotPaginationQuerySchema = cursorPaginationQuerySchema.extend({
  cursor: z.string().uuid().optional(),
});

export const botParams = z.object({
  sokoBotId: z
    .string()
    .uuid()
    .openapi({ param: { name: "sokoBotId", in: "path" } }),
});

export function mapDetail(
  detail: Awaited<ReturnType<typeof sokoBotControlPlane.getForAdmin>>,
) {
  const { user, ...bot } = detail;
  return { ...bot, owner: user };
}

export function traceIdFromTraceparent(traceparent: string | undefined) {
  const match = traceparent?.match(
    /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i,
  );
  return match?.[1]?.toLowerCase();
}

export function mapError(error: unknown): never {
  if (error instanceof SokoBotBillingAccessError)
    throw forbidden(error.message);
  if (error instanceof SokoBotNotFoundError) throw notFound(error.message);
  if (error instanceof SokoBotBusyError) throw conflict(error.message);
  if (
    error instanceof SokoBotStartAbortedError ||
    error instanceof SokoBotIdempotencyConflictError ||
    error instanceof SokoBotRetryableStartError
  ) {
    throw conflict(error.message);
  }
  if (error instanceof SokoBotValidationError) {
    throw unprocessableEntity(error.message);
  }
  throw error;
}

/** Shapes a resolved version for the API. */
export function versionDetail(
  version: {
    id: string;
    name: string;
    createdAt: string;
    summary: string;
    model: string;
    systemPrompt: string;
    skills: readonly string[];
    capabilities?: readonly string[];
    inferenceRegion?: "eu" | "us";
  },
  authored: boolean,
  defaultVersionId: string,
) {
  return sokoBotVersionDetailSchema.parse({
    id: version.id,
    name: version.name,
    createdAt: version.createdAt,
    summary: version.summary,
    model: version.model,
    inferenceRegion: version.inferenceRegion ?? null,
    systemPrompt: version.systemPrompt,
    skills: [...version.skills],
    capabilities: [...(version.capabilities ?? [])],
    authored,
    isDefault: version.id === defaultVersionId,
  });
}
