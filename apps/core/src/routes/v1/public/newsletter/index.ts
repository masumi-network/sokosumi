import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";
import { assertNewsletterEnabled } from "@/lib/newsletter/feature";

import mountConfirmGet from "./confirm/get.js";
import mountConfirmPost from "./confirm/post.js";
import mountGet from "./unsubscribe/get.js";
import mountPost from "./unsubscribe/post.js";

const app = new OpenAPIHono({ defaultHook: defaultValidationHook });
app.use("/confirm", async (_c, next) => {
  assertNewsletterEnabled();
  await next();
});
mountGet(app);
mountPost(app);
mountConfirmGet(app);
mountConfirmPost(app);

export default app;
