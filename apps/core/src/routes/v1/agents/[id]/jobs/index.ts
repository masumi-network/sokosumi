import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostJob from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountPostJob(app);

export default app;
