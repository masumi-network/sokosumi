import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";

import mountGet from "./get.js";
import mountSubscribe from "./subscribe/post.js";

const app = new OpenAPIHono({ defaultHook: defaultValidationHook });
mountGet(app);
mountSubscribe(app);

export default app;
