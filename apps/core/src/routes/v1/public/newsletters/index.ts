import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";
import { assertNewsletterEnabled } from "@/lib/newsletter/feature";

import mountGet from "./get.js";
import mountGetIssue from "./issues/[issueSlug]/get.js";
import mountListIssues from "./issues/get.js";
import mountSubscribe from "./subscribe/post.js";

const app = new OpenAPIHono({ defaultHook: defaultValidationHook });
app.use("*", async (_c, next) => {
  assertNewsletterEnabled();
  await next();
});
mountGet(app);
mountListIssues(app);
mountGetIssue(app);
mountSubscribe(app);

export default app;
