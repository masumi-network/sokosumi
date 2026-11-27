import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountClaims from "./claims/post.js";

// The global SEO worker's queue: no workspace, so no workspace context.
const app = new OpenAPIHonoWithAuth();

mountClaims(app);

export default app;
