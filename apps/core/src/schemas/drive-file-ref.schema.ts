import { z } from "@hono/zod-openapi";

/** A Drive file a client names by its blob pathname and public URL; see `DriveFileRef`. */
export const driveFileRefShape = {
  pathname: z.string().min(1).openapi({
    example: "drive/users/user_123/launch.png",
    description: "Drive blob pathname; must belong to the active workspace",
  }),
  fileUrl: z.string().url().openapi({
    example:
      "https://store.public.blob.vercel-storage.com/drive/users/user_123/launch.png",
    description: "Public Blob URL of the Drive file",
  }),
  name: z.string().min(1).openapi({ example: "launch.png" }),
};
