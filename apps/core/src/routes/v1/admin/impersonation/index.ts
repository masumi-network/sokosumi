import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountStopImpersonation from "./delete.js";
import mountStartImpersonation from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountStartImpersonation(app);
mountStopImpersonation(app);

export default app;
