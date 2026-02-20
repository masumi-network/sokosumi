import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserActorMiddleware } from "@/middleware/auth";

import mountPostJob from "./post.js";

const app = new OpenAPIHonoWithAuth();
app.use("*", requireUserActorMiddleware);

mountPostJob(app);

export default app;
