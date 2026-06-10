import { OpenAPIHono } from "@hono/zod-openapi";

import mountGetInvitationById from "./[id]/get.js";

const app = new OpenAPIHono();

mountGetInvitationById(app);

export default app;
