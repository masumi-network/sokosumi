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

export const studioRouterArmSchema = z
  .enum(["router:sonnet-5", "router:opus-5.5"])
  .openapi("StudioRouterArm");

export type StudioRouterArm = z.infer<typeof studioRouterArmSchema>;

export type ImageStudioRoute = z.infer<typeof imageStudioRouteSchema>;

export function readImageStudioRoute(
  metadata: unknown,
): ImageStudioRoute | undefined {
  if (!metadata || typeof metadata !== "object" || !("route" in metadata))
    return undefined;
  return imageStudioRouteSchema.safeParse(metadata.route).data;
}

const routerSettingsSchema = z.object({ experimentArm: studioRouterArmSchema });

export function readStudioRouterArm(settings: unknown): StudioRouterArm | null {
  return routerSettingsSchema.safeParse(settings).data?.experimentArm ?? null;
}
