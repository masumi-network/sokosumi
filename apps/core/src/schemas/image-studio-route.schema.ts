import { z } from "@hono/zod-openapi";

export const imageStudioRouteSchema = z
  .enum([
    "photo_ad",
    "text_heavy",
    "vector",
    "svg_diagram",
    "make_realistic",
    "edit",
  ])
  .openapi("ImageStudioRoute");

export type ImageStudioRoute = z.infer<typeof imageStudioRouteSchema>;

export function readImageStudioRoute(
  metadata: unknown,
): ImageStudioRoute | undefined {
  if (!metadata || typeof metadata !== "object" || !("route" in metadata))
    return undefined;
  return imageStudioRouteSchema.safeParse(metadata.route).data;
}
