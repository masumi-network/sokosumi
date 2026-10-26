import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";

import mountGet from "./unsubscribe/get.js";
import mountPost from "./unsubscribe/post.js";

const app = new OpenAPIHono({ defaultHook: defaultValidationHook });
mountGet(app);
mountPost(app);

export default app;
