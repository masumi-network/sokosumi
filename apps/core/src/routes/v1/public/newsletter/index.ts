import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";
import { assertNewsletterEnabled } from "@/lib/newsletter/feature";

import mountGet from "./unsubscribe/get.js";
import mountPost from "./unsubscribe/post.js";

const app = new OpenAPIHono({ defaultHook: defaultValidationHook });
app.use("*", async (_c, next) => {
  assertNewsletterEnabled();
  await next();
});
mountGet(app);
mountPost(app);

export default app;
