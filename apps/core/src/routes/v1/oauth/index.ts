import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostOAuthToken from "./token/post.js";

const app = new OpenAPIHonoWithAuth();

mountPostOAuthToken(app);

export default app;
