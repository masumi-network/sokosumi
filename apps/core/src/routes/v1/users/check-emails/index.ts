import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostCheckEmails from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountPostCheckEmails(app);

export default app;
