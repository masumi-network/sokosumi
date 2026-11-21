import { z } from "@hono/zod-openapi";

export const setSokoBotAvatarCodeRequestSchema = z.object({
  // Parsed by the service, which answers 422 `avatar_code_invalid`.
  code: z.string().min(1).max(120).openapi({
    example: "v1.owl.golden.peach.crimson.l.M.original.original.none.none",
  }),
});

export const sokoBotAvatarCodeSchema = z
  .object({
    avatarCode: z.string(),
    avatarImageUrl: z.string(),
  })
  .openapi("SokoBotAvatarCode");
