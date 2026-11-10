import { z } from "@hono/zod-openapi";

export const studioLogoPositionSchema = z
  .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
  .openapi("StudioLogoPosition");

export const studioLogoPositionOrNullSchema = z.union([
  studioLogoPositionSchema,
  z.null(),
]);
