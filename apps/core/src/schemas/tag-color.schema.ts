import { z } from "@hono/zod-openapi";
import { TagColor } from "@sokosumi/database";

export const tagColorSchema = z.enum(TagColor).openapi("TagColor");
