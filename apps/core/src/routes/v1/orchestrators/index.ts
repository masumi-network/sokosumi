import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostOrchestratorMePurge from "./me/purge/post.js";
import mountPostOrchestratorMeUsage from "./me/usage/post.js";

const app = new OpenAPIHonoWithAuth();

// Hermes service (env token): usage + purge for a body userId
mountPostOrchestratorMeUsage(app);
mountPostOrchestratorMePurge(app);

export default app;
